/**
 * @typedef AgroTime
 * @property {bigint} gameId
 * @property {number} time
 */

class AgroHistory {
  constructor() {
    /**
     * @type {Map<bigint, Date>}
     */
    this.lastAgroAcquiredTime = new Map();
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
    this.lastAgroAcquiredTime.clear();
    this.agroTimeHistory = [];
    if (isRaid !== undefined) this.isRaid = isRaid;
  }

  add(target, isAcquired) {
    if (isAcquired) {
      this.lastAgroAcquiredTime.set(target, new Date());
      return;
    }
    const prev = this.lastAgroAcquiredTime.get(target);
    this.lastAgroAcquiredTime.delete(target);
    if (!prev) return;
    this.addHistory(target, new Date() - prev);
  }

  addHistory(gameId, time) {
    const newLength = this.agroTimeHistory.push({ gameId, time });
    if (newLength > this.maxHistoryLength) this.agroTimeHistory.shift();
  }

  /**
   * @returns {bigint | null}
   */
  getDynamicTank() {
    /**
     * @type {Map.<bigint, number>}
     */
    // Sum agro time by gameId
    const cummulativeTime = this.agroTimeHistory.reduce(
      (acc, cur) => acc.set(cur.gameId, (acc.get(cur.gameId) || 0) + cur.time),
      new Map()
    );
    const cummulativeTimeEntries = Array.from(cummulativeTime.entries());
    // Select gameId key correspoding to max time value
    const maxCummulativeId = cummulativeTimeEntries.reduce(
      (max, entry) => (entry[1] > max[1] ? entry : max),
      [null, -Infinity]
    )[0];
    return maxCummulativeId;
  }

  run(mod) {
    this.intervalHandle = mod.setInterval(() => {
      const now = new Date();
      this.lastAgroAcquiredTime.forEach((value, key, map) => {
        this.addHistory(key, now - value);
        map.set(key, now);
      });
    }, this.agroHistoryInterval);
  }

  stop(mod) {
    if (this.intervalHandle) mod.clearInterval(this.intervalHandle);
  }
}

module.exports = function PartyDeathMarkers(mod) {
  let members = [];
  let markers = [];
  const history = new AgroHistory();

  mod.game.on("enter_game", () => {
    removeAllMarkers();
    history.run(mod);
  });
  mod.game.on("leave_game", () => history.stop(mod));
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

  mod.hook("S_PARTY_MEMBER_LIST", 8, (event) => {
    members = event.members;
    history.clear(event.raid);
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
    },
    this
  );

  function spawnMarker(member, loc) {
    if (!mod.settings.enabled) return;
    if (!member || mod.game.me.is(member.gameId)) return;

    removeMarker(member);
    markers.push(member.playerId);

    mod.toClient("S_SPAWN_DROPITEM", 9, {
      gameId: member.playerId,
      loc: loc,
      item: getMarker(getRole(member.class, member.gameId)),
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
   * @param {number} classId
   * @param {bigint} gameId
   * @returns {"tank" | "healer" | "dps"}
   */
  function getRole(classId, gameId) {
    // Clear roles:
    if (ClassId.Lancer.includes(classId)) return "tank";
    if (ClassId.Healer.includes(classId)) return "healer";

    // Dynamic determination
    if (mod.settings.dynamicTank && !history.isRaid) return history.getDynamicTank(mod) === gameId ? "tank" : "dps";

    // Static determination:
    if (ClassId.Brawler.includes(classId)) return "tank";
    return "dps";
  }

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
