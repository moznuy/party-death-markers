/**
 * @typedef AgroTime
 * @property {bigint} gameId
 * @property {number} time
 */

module.exports = function PartyDeathMarkers(mod) {
  let members = [];
  let markers = [];
  const dynamicTank = true;
  let isRaid = false;
  /**
   * @type {Map<bigint, Date>}
   */
  const lastAgroAcquiredTime = new Map();
  /**
   * @type {AgroTime[]}
   */
  let agroTimeHistory = [];
  const agroHistoryIntervalDelay = 5000;
  const maxHistoryLength = 60;
  // max time(ms) = maxHistoryLength * agroHistoryIntervalDelay(ms)

  function clear() {
    removeAllMarkers();
    members = [];
    lastAgroAcquiredTime.clear();
    agroTimeHistory = [];
    isRaid = false;
  }

  mod.game.on("enter_game", clear);
  let handleTmp = null;
  mod.game.on("enter_game", () => {
    handleTmp = mod.setInterval(() => {
      const now = new Date();
      lastAgroAcquiredTime.forEach((value, key, map) => {
        addAgroHistory(key, now - value);
        map.set(key, now);
      });
      getDynamicTankId();
    }, agroHistoryIntervalDelay);
  });
  mod.game.on("leave_game", () => {
    if (handleTmp) mod.clearInterval(handleTmp);
  });

  mod.hook("S_USER_EFFECT", 1, (event) => {
    if (![1, 2].includes(event.operation)) {
      mod.warn(`Unknown aggro operation encountered: ${event.operation}`);
      return;
    }
    if (![2, 3].includes(event.circle)) {
      mod.warn(`Unknown aggro circle encountered: ${event.circle}`);
      return;
    }
    const isAcquired = event.operation === 1;
    const mainAgro = event.circle === 2;
    if (!mainAgro) return;
    if (isAcquired) {
      lastAgroAcquiredTime.set(event.target, new Date());
      return;
    }
    const prev = lastAgroAcquiredTime.get(event.target);
    lastAgroAcquiredTime.delete(event.target);
    if (!prev) return;
    addAgroHistory(event.target, new Date() - prev);
  });

  function addAgroHistory(gameId, time) {
    const newLength = agroTimeHistory.push({ gameId, time });
    if (newLength > maxHistoryLength) agroTimeHistory.shift();
  }

  /**
   * @returns {bigint | null}
   */
  function getDynamicTankId() {
    /**
     * @type {Map.<bigint, number>}
     */
    const cummulativeTime = agroTimeHistory.reduce(
      (acc, cur) => acc.set(cur.gameId, (acc.get(cur.gameId) || 0) + cur.time),
      new Map()
    );
    const cummulativeTimeEntries = Array.from(cummulativeTime.entries());
    // mod.log("agroTimeHistory", agroTimeHistory);
    // mod.log("cummulativeTime", cummulativeTimeEntries);
    // const niceLog = Object.fromEntries(cummulativeTimeEntries.map(([gameId, time]) => [mapName.get(gameId), time]));
    // mod.log("niceLog", niceLog);
    // Select gameId key correspoding to max time value
    const maxCummulative = cummulativeTimeEntries.reduce(
      (max, entry) => (entry[1] > max[1] ? entry : max),
      [null, -Infinity]
    )[0];
    // mod.log("mapName", mapName);
    // mod.log("maxCummulative", maxCummulative, mapName.get(maxCummulative), mod.game.me.is(maxCummulative));
    return maxCummulative;
  }

  // let mapName = new Map();
  // mod.game.on("enter_game", () => {
  //   mapName.set(mod.game.me.gameId, mod.game.me.name);
  //   mod.log("mapName enter_game", mapName);
  // });
  mod.hook("S_PARTY_MEMBER_LIST", 8, (event) => {
    members = event.members;
    isRaid = event.raid;
    // mapName = new Map(members.map((member) => [member.gameId, member.name]));
    // mapName.set(mod.game.me.gameId, mod.game.me.name);
    // mod.log("mapName S_PARTY_MEMBER_LIST", mapName);
  });

  mod.hook("S_DEAD_LOCATION", 2, (event) => {
    spawnMarker(
      members.find((member) => member.gameId === event.gameId),
      event.loc
    );
  });

  mod.hook("S_SPAWN_USER", 17, (event) => {
    if (!event.alive)
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
    clear();
  });

  function spawnMarker(member, loc) {
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

  const lancerIds = [1];
  const healerIds = [6, 7];
  const warriorIds = [0];
  const berserkIds = [3];
  const brawlerIds = [13];
  /**
   *
   * @param {number} classId
   * @param {bigint} gameId
   * @returns {"tank" | "healer" | "dps"}
   */
  function getRole(classId, gameId) {
    if (lancerIds.includes(classId)) return "tank";
    if (healerIds.includes(classId)) return "healer";
    mod.log("getRole", getDynamicTankId() === gameId ? "tank" : "dps");
    if (dynamicTank) return getDynamicTankId() === gameId ? "tank" : "dps";

    if (warriorIds.includes(classId)) {
      // Defensive Stance I, II and not added III, IV abnormality
      // [100200, 100201, 100202, 100203]
      // Assault Stance I, II, III, IV abnormality
      // [100100, 100101, 100102, 100103]
      // Locked in Defensive Stance abnormality
      // [102500]
      // for (const id of [100200, 100201]) if (effect.hasAbnormality(id)) return "tank";
    }

    if (berserkIds.includes(classId)) {
      // Intimidation abnormality
      // [401400]
      // if (effect.hasAbnormality(401400)) return "tank";
    }

    if (brawlerIds.includes(classId)) {
      // with Sensation of Power skill polishing
      // does not work for other person
      // if (this.__optionEffects[1104] === 17111802) return "tank";
      // return "tank";
    }
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
