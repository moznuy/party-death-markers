/**
 * @typedef AgroTime
 * @property {bigint} gameId
 * @property {number} time
 */

/**
 * @typedef Member
 * @property {number} serverId
 * @property {number} playerId
 * @property {number} level
 * @property {number} class
 * @property {bool} online
 * @property {bigint} gameId
 * @property {number} slot
 * @property {bool} canInvite
 * @property {number} laurel
 * @property {number} awakeningLevel
 * @property {string} name
 */

class AgroHistory {
  constructor(mod, idToName) {
    this.mod = mod;
    this.idToName = idToName || new Map();
    /**
     * @type {Map<bigint, Date>}
     */
    this.lastAgroAcquiredTime = new Map();
    /**
     * @type {bigint | null}
     */
    this.lastAgroId = null;
    /**
     * @type {AgroTime[]}
     */
    this.agroTimeHistory = [];
    this.isRaid = false;
    this.intervalHandle = null;

    // TODO: mod.settings?
    this.agroHistoryInterval = 5000;
    this.maxHistoryLength = 60;
    // History Time(ms) = maxHistoryLength * agroHistoryInterval(ms)
  }

  /**
   *
   * @param {boolean | undefined} isRaid
   */
  clear(isRaid) {
    if (this.mod.settings.debug) this.mod.log("Clear", isRaid);
    this.lastAgroAcquiredTime.clear();
    this.lastAgroId = null;
    this.agroTimeHistory = [];
    if (isRaid !== undefined) this.isRaid = isRaid;
  }

  /**
   *
   * @param {bigint} target
   * @param {boolean} isAcquired
   * @returns
   */
  add(target, isAcquired) {
    if (isAcquired) {
      this.lastAgroAcquiredTime.set(target, new Date());
      this.lastAgroId = target;
      return;
    }
    const prev = this.lastAgroAcquiredTime.get(target);
    this.lastAgroAcquiredTime.delete(target);
    if (!prev) return;
    this.addHistory(target, new Date() - prev);
  }

  /**
   *
   * @param {bigint} gameId
   * @param {number} time
   */
  addHistory(gameId, time) {
    const newLength = this.agroTimeHistory.push({ gameId, time });
    if (newLength > this.maxHistoryLength) this.agroTimeHistory.shift();
  }

  /**
   * Clear lastAgroAcquiredTime for all who is not a boss target
   * Fix for when there is no circle deagro event
   * @param {bigint} gameId
   */
  // clearOthers(gameId) {
  //   if (this.mod.settings.debug) this.mod.log("clearOthers", gameId);
  //   // Boss has no target
  //   if (gameId === 0n) return;
  //   this.lastAgroAcquiredTime.forEach((value, key, map) => {
  //     if (key === gameId) return;

  //     const removed = map.delete(key);
  //     if (this.mod.settings.debug) this.mod.log("Found lost agro: ", key, this.idToName.get(key), removed);
  //   });
  // }

  /**
   * @returns {bigint | null}
   */
  getDynamicTank(log) {
    /**
     * @type {Map.<bigint, number>}
     */
    // Sum agro time by gameId
    const cummulativeTime = this.agroTimeHistory.reduce(
      (acc, cur) => acc.set(cur.gameId, (acc.get(cur.gameId) || 0) + cur.time),
      new Map()
    );
    const cummulativeTimeEntries = Array.from(cummulativeTime.entries());
    if (this.mod.settings.debug) {
      // mod.log("agroTimeHistory", this.agroTimeHistory);
      if (cummulativeTimeEntries.length > 0) this.mod.log("cummulativeTime", cummulativeTimeEntries);
      if (log && cummulativeTimeEntries.length > 0)
        this.mod.command.message(`cummulativeTime: ${cummulativeTimeEntries}`);
      const niceLog = Object.fromEntries(
        cummulativeTimeEntries.map(([gameId, time]) => [this.idToName.get(gameId), time])
      );
      if (Object.keys(niceLog).length > 0) this.mod.log("niceLog", niceLog);
    }
    // Select gameId key correspoding to max time value
    const maxCummulativeId = cummulativeTimeEntries.reduce(
      (max, entry) => (entry[1] > max[1] ? entry : max),
      [null, -Infinity]
    )[0];
    if (this.mod.settings.debug) {
      // this.mod.log("idToName", Array.from(this.idToName.values()));
      this.mod.log(
        "maxCummulative",
        maxCummulativeId,
        this.idToName.get(maxCummulativeId),
        this.mod.game.me.is(maxCummulativeId)
      );
    }
    return maxCummulativeId;
  }

  run() {
    this.intervalHandle = this.mod.setInterval(() => {
      const now = new Date();
      this.lastAgroAcquiredTime.forEach((value, key, map) => {
        // Remove all except latest agro
        // TODO: remove this.lastAgroId and get latest by .reduce
        if (this.lastAgroId && this.lastAgroId !== key) {
          map.delete(key);
          if (this.mod.settings.debug) {
            const msg = `Removing not latest agro: ${key} ${this.idToName.get(key)}`;
            this.mod.log(msg);
            this.mod.command.message(msg);
          }
          return;
        }
        this.addHistory(key, now - value);
        map.set(key, now);
      });
      // To debug log continuously
      if (this.mod.settings.debug) this.getDynamicTank();
    }, this.agroHistoryInterval);
  }

  stop() {
    if (this.intervalHandle) this.mod.clearInterval(this.intervalHandle);
  }
}

const throttle = (mod, func, limit) => {
  let inThrottle = false;
  return (...args) => {
    if (inThrottle) return;

    func(...args);
    inThrottle = true;
    mod.setTimeout(() => (inThrottle = false), limit);
  };
};

module.exports = function PartyDeathMarkers(mod) {
  /**
   * @type {Member[]}
   */
  let members = [];
  /**
   * @type {number[]}
   */
  let markers = [];

  const idToName = new Map();
  const history = new AgroHistory(mod, idToName);

  mod.game.on("enter_game", () => {
    removeAllMarkers();
    history.run();
    idToName.set(mod.game.me.gameId, mod.game.me.name);
  });
  mod.game.on("leave_game", () => history.stop());
  mod.game.me.on("change_zone", () => history.clear());

  const Operation = {
    Acquired: 1,
    Lost: 2,
  };
  const AgroType = {
    Primary: 2,
    Secondary: 3,
  };
  const PossibleOperations = Object.values(Operation);
  const PossibleAgroTypes = Object.values(AgroType);
  mod.hook("S_USER_EFFECT", 1, (event) => {
    if (!PossibleOperations.includes(event.operation)) {
      mod.warn(`Unknown aggro operation encountered: ${event.operation}. Valid are: ${PossibleOperations}`);
      return;
    }
    if (!PossibleAgroTypes.includes(event.circle)) {
      mod.warn(`Unknown aggro circle encountered: ${event.circle}. Valid are: ${PossibleAgroTypes}`);
      return;
    }
    const isAcquired = event.operation === Operation.Acquired;
    const isMainAgro = event.circle === AgroType.Primary;
    if (!isMainAgro) return;
    history.add(event.target, isAcquired);
  });

  // TODO: figure out what to do with lost agro
  // TODO: figure out what to do with bosses without primary agro indicator
  // mod.hook(
  //   "S_BOSS_GAGE_INFO",
  //   3,
  //   throttle(mod, (event) => history.clearOthers(event.target), 1000)
  // );

  mod.hook("S_PARTY_MEMBER_LIST", 8, (event) => {
    members = event.members;
    history.clear(event.raid);
    idToName.clear();
    idToName.set(mod.game.me.gameId, mod.game.me.name);
    members.forEach((member) => idToName.set(member.gameId, member.name));
  });

  mod.hook("S_DEAD_LOCATION", 2, (event) => {
    spawnMarker(
      members.find((member) => member.gameId === event.gameId),
      event.loc
    );
  });

  mod.hook("S_SPAWN_USER", 17, (event) => {
    if (event.alive) return;

    spawnMarker(
      members.find((member) => member.gameId === event.gameId),
      event.loc
    );
  });

  mod.hook("S_PARTY_MEMBER_STAT_UPDATE", 3, (event) => {
    if (mod.game.me.playerId === event.playerId) return;

    if (markers.length > 0 && event.alive && event.curHp > 0)
      removeMarker(members.find((member) => member.playerId === event.playerId));
  });

  mod.hook("S_LEAVE_PARTY_MEMBER", 2, (event) => {
    removeMarker(members.find((member) => member.playerId === event.playerId));
  });

  mod.hook("S_LEAVE_PARTY", 1, () => {
    removeAllMarkers();
    members = [];
    history.clear(false);
  });

  mod.command.add(
    ["death"],
    {
      show: () => {
        mod.settings.enabled = !mod.settings.enabled;
        mod.command.message(`Death markers was ${mod.settings.enabled ? "en" : "dis"}abled`);
        if (!mod.settings.enabled) removeAllMarkers();
      },
      dynamic: () => {
        mod.settings.dynamicTank = !mod.settings.dynamicTank;
        mod.command.message(`Dynamic Tank determination was ${mod.settings.dynamicTank ? "en" : "dis"}abled`);
      },
      debug: () => {
        mod.settings.debug = !mod.settings.debug;
        mod.command.message(`Debug Dynamic Tank determination was ${mod.settings.debug ? "en" : "dis"}abled`);
      },
    },
    this
  );

  /**
   *
   * @param {Member} member
   * @param {any} loc
   */
  function spawnMarker(member, loc) {
    if (!mod.settings.enabled) return;
    if (!member || mod.game.me.is(member.gameId)) return;

    removeMarker(member);
    markers.push(member.playerId);

    mod.toClient("S_SPAWN_DROPITEM", 9, {
      gameId: member.playerId,
      loc: loc,
      item: getMarker(getRole(member)),
      amount: 1,
      expiry: 999999,
      owners: [mod.game.me.playerId],
    });
  }

  /*
  Found ids in Arborea:
  8026              blue-violet slightly swirl small (battle orb)
  45411             blue easy straight small (kumas candy)
  46703             big red-blue swirl (operation: velika invasion)
    88704           same (velika banqet coin)
  89807             small violet swirl (warlod bracing neklace)
    102026          small violet swirl (no text) 
    102064          small red swirl (no text)
  110629            big red-blue swirl; (no text scroll item)
    110684-110711   small light blue swirl (no text equipment item)
  */
  /**
   *
   * @param {"tank" | "healer" | "dps"} role
   * @returns {number}
   */
  function getMarker(role) {
    switch (role) {
      case "tank":
        return 102064;
      case "healer":
        return 88704;
      case "dps":
      default:
        return 102026;
    }
  }

  const ClassId = {
    Lancer: [1],
    Healer: [6, 7],
    Warrior: [0],
    Berserk: [3],
    Brawler: [13],
  };
  /**
   *
   * @param {Member} member
   * @returns {"tank" | "healer" | "dps"}
   */
  function getRole(member) {
    const tankId = history.getDynamicTank(true);
    if (mod.settings.debug)
      mod.command.message(
        `Tank: ${tankId} ${idToName.get(tankId)}; dead: ${member.gameId} ${idToName.get(member.gameId)}; ${
          tankId === member.gameId
        }`
      );

    // Clear roles:
    if (ClassId.Lancer.includes(member.class)) return "tank";
    if (ClassId.Healer.includes(member.class)) return "healer";

    // Dynamic determination
    if (mod.settings.dynamicTank && !history.isRaid) return tankId === member.gameId ? "tank" : "dps";

    // Static determination:
    if (ClassId.Brawler.includes(member.class)) return "tank";
    return "dps";
  }

  /**
   *
   * @param {Member | undefined} member
   * @returns
   */
  function removeMarker(member) {
    if (!member) return;

    const id = member.playerId;
    if (markers.includes(id)) {
      mod.toClient("S_DESPAWN_DROPITEM", 4, { gameId: id });
      markers = markers.filter((marker) => marker !== id);
    }
  }

  function removeAllMarkers() {
    members.forEach((member) => removeMarker(member));
    markers = [];
  }
};
