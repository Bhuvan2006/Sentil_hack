(function () {
  const { INTRO_STEPS, LEVELS, FLOOD_TIPS, TILE_META, TOTAL_MAX_SCORE } = window.FloodScenarios;

  const TILE_TYPES = {
    ROAD: "road",
    HOUSE: "house",
    LOW: "low",
    SAFE: "safe"
  };

  const tileElements = [];
  const state = {
    score: 0,
    totalTime: 0,
    levelIndex: 0,
    level: null,
    levelTime: 0,
    waterLevel: 0,
    player: { x: 0, y: 0 },
    movementLocked: true,
    campaignFinished: false,
    introStepIndex: 0,
    timerId: null,
    floodIntervalId: null,
    triggeredScenarios: new Set(),
    mistakes: [],
    learnedTips: new Set(),
    floodedTiles: new Set(),
    pendingFloodTiles: new Set(),
    activeSources: [],
    lastLevelSummary: null,
    levelHistory: []
  };

  const boardEl = document.getElementById("gameBoard");
  const appShellEl = document.getElementById("appShell");
  const toastEl = document.getElementById("toast");
  const levelNameEl = document.getElementById("levelName");
  const boardTitleEl = document.getElementById("boardTitle");
  const timeEl = document.getElementById("timeElapsed");
  const waterEl = document.getElementById("waterLevel");
  const scoreEl = document.getElementById("score");
  const warningTextEl = document.getElementById("warningText");
  const statusTextEl = document.getElementById("statusText");
  const riskLabelEl = document.getElementById("riskLabel");

  const introOverlayEl = document.getElementById("introOverlay");
  const introTitleEl = document.getElementById("introTitle");
  const introDescriptionEl = document.getElementById("introDescription");
  const introStepLabelEl = document.getElementById("introStepLabel");
  const introPrevButtonEl = document.getElementById("introPrevButton");
  const introNextButtonEl = document.getElementById("introNextButton");
  const introSkipButtonEl = document.getElementById("introSkipButton");

  const scenarioOverlayEl = document.getElementById("scenarioOverlay");
  const scenarioTitleEl = document.getElementById("scenarioTitle");
  const scenarioDescriptionEl = document.getElementById("scenarioDescription");
  const scenarioChoicesEl = document.getElementById("scenarioChoices");

  const levelOverlayEl = document.getElementById("levelOverlay");
  const levelDialogTagEl = document.getElementById("levelDialogTag");
  const levelResultTitleEl = document.getElementById("levelResultTitle");
  const levelResultSummaryEl = document.getElementById("levelResultSummary");
  const levelScoreEl = document.getElementById("levelScore");
  const levelAwarenessEl = document.getElementById("levelAwareness");
  const levelSuggestionListEl = document.getElementById("levelSuggestionList");
  const continuePromptEl = document.getElementById("continuePrompt");

  const endOverlayEl = document.getElementById("endOverlay");
  const endTitleEl = document.getElementById("endTitle");
  const endSummaryEl = document.getElementById("endSummary");
  const finalScoreEl = document.getElementById("finalScore");
  const awarenessLevelEl = document.getElementById("awarenessLevel");
  const mistakeListEl = document.getElementById("mistakeList");
  const tipsListEl = document.getElementById("tipsList");
  const analysisListEl = document.getElementById("analysisList");
  let toastTimeoutId = null;

  document.getElementById("restartButton").addEventListener("click", resetCampaign);
  document.getElementById("playAgainButton").addEventListener("click", resetCampaign);
  document.getElementById("restartSimulationButton").addEventListener("click", resetCampaign);
  document.getElementById("continueButton").addEventListener("click", continueAfterLevel);
  document.getElementById("exitButton").addEventListener("click", () => {
    const summary = state.lastLevelSummary;
    endCampaign(
      "Campaign Ended Early",
      summary
        ? `You stopped after ${summary.levelName}. Ending early is better than taking unsafe chances in worsening flood conditions.`
        : "You ended the campaign before starting the next level."
    );
  });
  introPrevButtonEl.addEventListener("click", retreatIntro);
  introNextButtonEl.addEventListener("click", advanceIntro);
  introSkipButtonEl.addEventListener("click", skipIntro);
  document.addEventListener("keydown", handleKeyDown);

  function init() {
    buildBoard();
    resetCampaign();
  }

  function buildBoard() {
    boardEl.innerHTML = "";
    tileElements.length = 0;

    for (let y = 0; y < 10; y += 1) {
      for (let x = 0; x < 10; x += 1) {
        const tile = document.createElement("div");
        tile.className = "tile";
        tile.dataset.x = String(x);
        tile.dataset.y = String(y);
        boardEl.appendChild(tile);
        tileElements.push(tile);
      }
    }
  }

  function resetCampaign() {
    stopTimers();

    const previewLevel = LEVELS[0];

    state.score = 0;
    state.totalTime = 0;
    state.levelIndex = 0;
    state.level = previewLevel;
    state.levelTime = 0;
    state.waterLevel = 0;
    state.player = { ...previewLevel.start };
    state.movementLocked = true;
    state.campaignFinished = false;
    state.introStepIndex = 0;
    state.triggeredScenarios = new Set();
    state.mistakes = [];
    state.learnedTips = new Set();
    state.floodedTiles = new Set(previewLevel.floodSources.map((source) => coordKey(source.x, source.y)));
    state.pendingFloodTiles = new Set();
    state.activeSources = previewLevel.floodSources.map((source) => ({ ...source }));
    state.lastLevelSummary = null;
    state.levelHistory = [];

    scenarioOverlayEl.classList.add("hidden");
    levelOverlayEl.classList.add("hidden");
    endOverlayEl.classList.add("hidden");
    introOverlayEl.classList.remove("hidden");
    // appShell visibility is controlled by the start-splash button

    updateIntroStep();
    updateStatus(
      "Mission briefing ready.",
      "Read the intro or skip it, then begin Level 1."
    );

    levelNameEl.textContent = `1 / ${LEVELS.length}`;
    boardTitleEl.textContent = "Level 1: Neighborhood Start";
    timeEl.textContent = "0s";
    waterEl.textContent = "0 cm";
    scoreEl.textContent = "0";
    riskLabelEl.textContent = "Floodwater spreads gradually from risky areas every few seconds.";
    renderBoard();
  }

  function startLevel(levelIndex) {
    stopTimers();

    state.levelIndex = levelIndex;
    state.level = LEVELS[levelIndex];
    state.levelTime = 0;
    state.waterLevel = 0;
    state.score = 0;
    state.player = { ...state.level.start };
    state.movementLocked = false;
    state.triggeredScenarios = new Set();
    state.floodedTiles = new Set(state.level.floodSources.map((source) => coordKey(source.x, source.y)));
    state.pendingFloodTiles = new Set();
    state.activeSources = state.level.floodSources.map((source) => ({ ...source }));

    introOverlayEl.classList.add("hidden");
    scenarioOverlayEl.classList.add("hidden");
    levelOverlayEl.classList.add("hidden");
    endOverlayEl.classList.add("hidden");

    boardTitleEl.textContent = `Level ${state.level.id}: ${state.level.name}`;
    updateStatus(
      `Level ${state.level.id} started.`,
      state.level.intro
    );

    updateHud();
    renderBoard();

    state.timerId = setInterval(tickGame, 1000);
    state.floodIntervalId = setInterval(spreadFlood, state.level.floodSpreadDelay);
  }

  function tickGame() {
    if (state.campaignFinished || state.movementLocked || !state.level) {
      return;
    }

    state.levelTime += 1;
    state.totalTime += 1;
    state.waterLevel += state.level.waterRisePerSecond;

    if (state.waterLevel >= state.level.criticalWaterLevel - 6) {
      updateStatus(
        "Critical warning: water is nearing emergency level.",
        "Safe routes are shrinking. Avoid uncertainty and stay on verified paths."
      );
    }

    updateHud();
    renderBoard();
    checkEndConditions();
  }

  function spreadFlood() {
    if (state.campaignFinished || state.movementLocked || !state.level) {
      return;
    }

    const nextWave = [];
    const queued = new Set();

    if (state.pendingFloodTiles.size > 0) {
      state.pendingFloodTiles.forEach((key) => {
        state.floodedTiles.add(key);
        const point = parseCoord(key);
        nextWave.push(point);
      });
      state.pendingFloodTiles.clear();
    } else {
      nextWave.push(...state.activeSources);
    }

    const expandFrom = nextWave.length ? nextWave : state.activeSources;
    const newPending = new Set();

    expandFrom.forEach((source) => {
      getNeighbors(source.x, source.y).forEach((neighbor) => {
        const key = coordKey(neighbor.x, neighbor.y);
        if (queued.has(key) || state.floodedTiles.has(key)) {
          return;
        }

        const type = getTileType(neighbor.x, neighbor.y);
        if (type === TILE_TYPES.HOUSE || type === TILE_TYPES.SAFE) {
          return;
        }

        queued.add(key);
        newPending.add(key);
      });
    });

    state.pendingFloodTiles = newPending;
    state.activeSources = [...state.floodedTiles].map(parseCoord);

    if (newPending.size > 0) {
      updateStatus(
        "Water is pushing into new blocks.",
        "Floodwater is spreading tile by tile. Routes that were safe a moment ago may soon close."
      );
    }

    updateHud();
    renderBoard();
    checkEndConditions();
  }

  function handleKeyDown(event) {
    if (state.campaignFinished || state.movementLocked || !state.level) {
      return;
    }

    const key = event.key.toLowerCase();
    const movements = {
      arrowup: { x: 0, y: -1 },
      w: { x: 0, y: -1 },
      arrowdown: { x: 0, y: 1 },
      s: { x: 0, y: 1 },
      arrowleft: { x: -1, y: 0 },
      a: { x: -1, y: 0 },
      arrowright: { x: 1, y: 0 },
      d: { x: 1, y: 0 }
    };

    const move = movements[key];
    if (!move) {
      return;
    }

    event.preventDefault();

    const nextX = state.player.x + move.x;
    const nextY = state.player.y + move.y;

    if (!isInsideMap(nextX, nextY)) {
      updateStatus(
        "Boundary reached.",
        "You cannot move outside the mapped neighborhood."
      );
      return;
    }

    const targetType = getTileType(nextX, nextY);
    if (targetType === TILE_TYPES.HOUSE) {
      const message = "Blocked: you cannot move through a house. Use the road around it.";
      updateStatus(
        "House blocks the way.",
        "Just like a real street layout, you cannot pass through homes. Use the open road around it."
      );
      showToast(message);
      return;
    }

    state.player.x = nextX;
    state.player.y = nextY;

    const flooded = isFlooded(nextX, nextY);
    if (flooded) {
      state.score -= 8;
      addMistake("You stepped onto a road or low area that had already flooded.");
      updateStatus(
        "Unsafe move into floodwater.",
        "That block is already flooded. Water depth and current are hard to judge in real conditions."
      );
    } else if (targetType === TILE_TYPES.SAFE) {
      state.score += 4;
      updateStatus(
        "You reached higher ground.",
        "Safe zones reduce exposure while you continue toward the marked shelter."
      );
    } else if (targetType === TILE_TYPES.LOW) {
      state.score -= 2;
      updateStatus(
        "Low area entered.",
        "This block is flood-prone. Watch the spread pattern and do not linger."
      );
    } else {
      updateStatus(
        "Route updated.",
        "Watch nearby water sources and keep looking for the safest path to the goal."
      );
    }

    updateHud();
    renderBoard();
    maybeTriggerScenario();
    checkEndConditions();
  }

  function maybeTriggerScenario() {
    const key = coordKey(state.player.x, state.player.y);
    const scenario = state.level.scenarios[key];

    if (!scenario || state.triggeredScenarios.has(key) || state.campaignFinished) {
      return;
    }

    state.movementLocked = true;
    state.triggeredScenarios.add(key);

    scenarioTitleEl.textContent = scenario.title;
    scenarioDescriptionEl.textContent = scenario.description;
    scenarioChoicesEl.innerHTML = "";

    scenario.choices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = choice.label;
      button.addEventListener("click", () => applyScenarioChoice(choice, scenario));
      scenarioChoicesEl.appendChild(button);
    });

    scenarioOverlayEl.classList.remove("hidden");
  }

  function applyScenarioChoice(choice, scenario) {
    state.score += choice.score;

    if (choice.waterDelta) {
      state.waterLevel += choice.waterDelta;
    }

    if (choice.mistake) {
      addMistake(choice.mistake);
    }

    if (choice.tip) {
      state.learnedTips.add(choice.tip);
    }

    updateStatus("Decision recorded.", choice.status);

    // If it was a bad choice (negative score), show the wrong-choice panel
    const isWrongChoice = choice.score < 0;
    if (isWrongChoice && scenario) {
      const correctChoice = scenario.choices.find((c) => c.score > 0) || null;
      showWrongChoicePanel(choice, correctChoice, scenario);
      // Don't unlock movement yet — wcpContinueBtn will do that
      return;
    }

    scenarioOverlayEl.classList.add("hidden");
    state.movementLocked = false;

    updateHud();
    renderBoard();
    checkEndConditions();
  }

  // ── Wrong-choice feedback panel ────────────────────────────────────────────
  const wrongChoicePanelEl  = document.getElementById("wrongChoicePanel");
  const wcpBadgeEl          = document.getElementById("wcpBadge");
  const wcpTitleEl          = document.getElementById("wcpTitle");
  const wcpWrongLabelEl     = document.getElementById("wcpWrongLabel");
  const wcpWrongReasonEl    = document.getElementById("wcpWrongReason");
  const wcpCorrectLabelEl   = document.getElementById("wcpCorrectLabel");
  const wcpCorrectReasonEl  = document.getElementById("wcpCorrectReason");
  const wcpContinueBtnEl    = document.getElementById("wcpContinueBtn");

  wcpContinueBtnEl.addEventListener("click", () => {
    wrongChoicePanelEl.classList.add("hidden");
    scenarioChoicesEl.classList.remove("hidden");
    scenarioOverlayEl.classList.add("hidden");
    state.movementLocked = false;
    updateHud();
    renderBoard();
    checkEndConditions();
  });

  function showWrongChoicePanel(wrongChoice, correctChoice, scenario) {
    // Hide the choice buttons, show the feedback panel
    scenarioChoicesEl.classList.add("hidden");
    wrongChoicePanelEl.classList.remove("hidden");

    wcpBadgeEl.textContent    = "Wrong Choice";
    wcpTitleEl.textContent    = scenario.title;

    wcpWrongLabelEl.textContent  = `You chose: "${wrongChoice.label}"`;
    wcpWrongReasonEl.textContent = wrongChoice.mistake
      ? `Why it was wrong: ${wrongChoice.mistake}`
      : wrongChoice.status;

    if (correctChoice) {
      wcpCorrectLabelEl.textContent  = `Better choice: "${correctChoice.label}"`;
      wcpCorrectReasonEl.textContent = correctChoice.tip
        ? `Why it works: ${correctChoice.tip}`
        : correctChoice.status;
    } else {
      wcpCorrectLabelEl.textContent  = "";
      wcpCorrectReasonEl.textContent = "";
    }
  }

  function checkEndConditions() {
    if (state.campaignFinished || !state.level) {
      return;
    }

    if (isPlayerOnFloodedRoad()) {
      endCampaign(
        "You Drowned In Flood",
        "Floodwater rose into the road block you were standing on and trapped you. Restart the simulation and move to higher or drier ground earlier."
      );
      return;
    }

    if (state.player.x === state.level.goal.x && state.player.y === state.level.goal.y) {
      finishLevel(true, "You reached the marked safe zone before conditions became critical.");
      return;
    }

    if (state.score <= state.level.lowScoreThreshold) {
      finishLevel(false, "Too many risky choices reduced your preparedness below a safe level.");
      return;
    }

    if (state.waterLevel >= state.level.criticalWaterLevel) {
      finishLevel(false, "Water reached the critical level before you secured a safe route.");
    }
  }

  function finishLevel(success, summary) {
    stopTimers();
    state.movementLocked = true;

    const levelSuggestions = buildLevelSuggestions();
    const awareness = getAwarenessLabel(state.score);
    const levelRecord = {
      levelId: state.level.id,
      levelName: state.level.name,
      success,
      score: state.score,
      time: state.levelTime,
      water: state.waterLevel,
      awareness,
      summary
    };

    state.levelHistory = state.levelHistory.filter((item) => item.levelId !== state.level.id);
    state.levelHistory.push(levelRecord);

    state.lastLevelSummary = {
      success,
      levelName: `Level ${state.level.id}: ${state.level.name}`,
      summary,
      awareness,
      score: state.score
    };

    levelDialogTagEl.textContent = success ? "Level Complete" : "Level Failed";
    levelResultTitleEl.textContent = success
      ? `Level ${state.level.id} Complete`
      : `Level ${state.level.id} Failed`;
    levelResultSummaryEl.textContent = summary;
    levelScoreEl.textContent = String(state.score);
    levelAwarenessEl.textContent = awareness;
    levelSuggestionListEl.innerHTML = "";

    levelSuggestions.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      levelSuggestionListEl.appendChild(li);
    });

    if (success && state.levelIndex < LEVELS.length - 1) {
      continuePromptEl.textContent = `Continue to Level ${state.level.id + 1} for a harder flood situation, or exit here?`;
      document.getElementById("continueButton").textContent = `Continue to Level ${state.level.id + 1}`;
    } else if (success) {
      continuePromptEl.textContent = "You cleared the final level. Continue to the campaign result or exit here?";
      document.getElementById("continueButton").textContent = "View Final Result";
    } else {
      continuePromptEl.textContent = "Would you like to retry from the next safe start point in the campaign or exit now?";
      document.getElementById("continueButton").textContent = "Retry Level";
    }

    levelOverlayEl.classList.remove("hidden");
  }

  function continueAfterLevel() {
    if (!state.lastLevelSummary || !state.level) {
      return;
    }

    levelOverlayEl.classList.add("hidden");

    if (!state.lastLevelSummary.success) {
      startLevel(state.levelIndex);
      return;
    }

    if (state.levelIndex < LEVELS.length - 1) {
      startLevel(state.levelIndex + 1);
      return;
    }

    endCampaign(
      "Congrats! You Completed The Simulation",
      "You finished all four flood-awareness levels and handled increasingly difficult situations across the neighborhood."
    );
  }

  function endCampaign(title, summary) {
    stopTimers();
    state.campaignFinished = true;
    state.movementLocked = true;
    levelOverlayEl.classList.add("hidden");
    scenarioOverlayEl.classList.add("hidden");
    introOverlayEl.classList.add("hidden");

    const overallScore = state.levelHistory.reduce((sum, item) => sum + item.score, 0);
    const awareness = getAwarenessLabel(overallScore);
    const mistakes = state.mistakes.length
      ? uniqueItems(state.mistakes)
      : ["You avoided major mistakes. Keep practicing early evacuation and verified-route planning."];
    const tips = uniqueItems([...state.learnedTips, ...FLOOD_TIPS]).slice(0, 6);
    const analysis = buildFinalAnalysis();

    endTitleEl.textContent = title;
    endSummaryEl.textContent = summary;

    // ── Score display: user marks / total marks
    const pct = Math.max(0, Math.min(100, Math.round((overallScore / TOTAL_MAX_SCORE) * 100)));
    const grade =
      pct >= 85 ? "Excellent" :
      pct >= 65 ? "Good" :
      pct >= 40 ? "Satisfactory" : "Needs Improvement";

    finalScoreEl.innerHTML = `
      <span class="score-fraction">${overallScore} <span class="score-sep">/</span> ${TOTAL_MAX_SCORE}</span>
      <span class="score-pct-label">${pct}% &mdash; ${grade}</span>
      <span class="score-bar-wrap"><span class="score-bar-fill" style="width:${pct}%"></span></span>
    `;
    awarenessLevelEl.textContent = awareness;

    mistakeListEl.innerHTML = "";
    mistakes.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      mistakeListEl.appendChild(li);
    });

    tipsListEl.innerHTML = "";
    tips.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      tipsListEl.appendChild(li);
    });

    analysisListEl.innerHTML = "";
    analysis.forEach((item) => {
      const li = document.createElement("li");
      li.textContent = item;
      analysisListEl.appendChild(li);
    });

    endOverlayEl.classList.remove("hidden");
  }

  function updateIntroStep() {
    const step = INTRO_STEPS[state.introStepIndex];
    introTitleEl.textContent = step.title;
    introDescriptionEl.textContent = step.description;
    introStepLabelEl.textContent = `${state.introStepIndex + 1} / ${INTRO_STEPS.length}`;
    introPrevButtonEl.classList.toggle("hidden", state.introStepIndex === 0);
    introPrevButtonEl.disabled = state.introStepIndex === 0;
    introNextButtonEl.textContent =
      state.introStepIndex === INTRO_STEPS.length - 1 ? "Start Game" : "Next";
  }

  function retreatIntro() {
    if (state.introStepIndex === 0) {
      return;
    }

    state.introStepIndex -= 1;
    updateIntroStep();
  }

  function advanceIntro() {
    if (state.introStepIndex < INTRO_STEPS.length - 1) {
      state.introStepIndex += 1;
      updateIntroStep();
      return;
    }

    startLevel(0);
  }

  function skipIntro() {
    startLevel(0);
  }

  function showToast(message) {
    if (toastTimeoutId) {
      clearTimeout(toastTimeoutId);
    }

    toastEl.textContent = message;
    toastEl.classList.remove("hidden", "show");
    void toastEl.offsetWidth;
    toastEl.classList.add("show");

    toastTimeoutId = setTimeout(() => {
      toastEl.classList.remove("show");
      toastEl.classList.add("hidden");
    }, 3600);
  }

  function updateHud() {
    if (!state.level) {
      return;
    }

    levelNameEl.textContent = `${state.level.id} / ${LEVELS.length}`;
    timeEl.textContent = `${state.levelTime}s`;
    waterEl.textContent = `${state.waterLevel} cm`;
    scoreEl.textContent = String(state.score);
    riskLabelEl.textContent =
      state.pendingFloodTiles.size > 0
        ? "Floodwater is queued to spread into nearby roads in the next wave."
        : `Water spreads every ${Math.round(state.level.floodSpreadDelay / 1000)}s in this level.`;
  }

  function renderBoard() {
    tileElements.forEach((tile) => {
      const x = Number(tile.dataset.x);
      const y = Number(tile.dataset.y);

      if (!state.level) {
        tile.className = "tile";
        tile.dataset.icon = "";
        tile.setAttribute("aria-label", "Empty tile");
        return;
      }

      const type = getTileType(x, y);
      const meta = TILE_META[type];
      const key = coordKey(x, y);

      tile.className = `tile tile-${type}`;
      tile.dataset.icon = meta.icon;
      tile.setAttribute("aria-label", `${meta.label} at ${x}, ${y}`);

      tile.classList.toggle("goal-tile", x === state.level.goal.x && y === state.level.goal.y);
      tile.classList.toggle("scenario-tile", Boolean(state.level.scenarios[key]));
      tile.classList.toggle("flood-source", state.level.floodSources.some((source) => source.x === x && source.y === y));
      tile.classList.toggle("incoming-flood", state.pendingFloodTiles.has(key));
      tile.classList.toggle("flooded", isFlooded(x, y));
      tile.classList.toggle("player", x === state.player.x && y === state.player.y);
    });

    const waterOpacity = state.level
      ? Math.min(state.waterLevel / state.level.criticalWaterLevel, 1) * 0.68
      : 0;
    boardEl.style.setProperty("--water-opacity", waterOpacity.toFixed(2));
  }

  function buildLevelSuggestions() {
    const suggestions = [];

    if (state.mistakes.length > 0) {
      suggestions.push(`Most recent lesson: ${state.mistakes[state.mistakes.length - 1]}`);
    }

    if (state.pendingFloodTiles.size > 0 || state.floodedTiles.size > state.level.floodSources.length) {
      suggestions.push("Watch how floodwater spreads over time instead of assuming the map will stay the same.");
    }

    suggestions.push("Avoid low areas once water starts spreading nearby.");
    suggestions.push("Use marked roads and safe zones instead of uncertain shortcuts.");

    if (state.learnedTips.size > 0) {
      suggestions.push(`Key reminder: ${[...state.learnedTips][state.learnedTips.size - 1]}`);
    }

    return uniqueItems(suggestions).slice(0, 4);
  }

  function buildFinalAnalysis() {
    if (state.levelHistory.length === 0) {
      return ["No levels were completed, so there is no full simulation analysis yet."];
    }

    return state.levelHistory
      .sort((a, b) => a.levelId - b.levelId)
      .map((item) => {
        const outcome = item.success ? "cleared" : "ended early";
        return `Level ${item.levelId} (${item.levelName}) ${outcome} with score ${item.score}, awareness ${item.awareness}, time ${item.time}s, and water ${item.water} cm.`;
      });
  }

  function getAwarenessLabel(score) {
    if (score >= 55) {
      return "Well Prepared";
    }
    if (score >= 20) {
      return "Improving";
    }
    return "At Risk";
  }

  function getTileType(x, y) {
    return state.level.map[y][x];
  }

  function isFlooded(x, y) {
    return state.floodedTiles.has(coordKey(x, y));
  }

  function isPlayerOnFloodedTile() {
    return isFlooded(state.player.x, state.player.y);
  }

  function isPlayerOnFloodedRoad() {
    const currentType = getTileType(state.player.x, state.player.y);
    return currentType === TILE_TYPES.ROAD && isFlooded(state.player.x, state.player.y);
  }

  function isInsideMap(x, y) {
    return y >= 0 && state.level && y < state.level.map.length && x >= 0 && x < state.level.map[0].length;
  }

  function getNeighbors(x, y) {
    return [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 }
    ].filter((point) => isInsideMap(point.x, point.y));
  }

  function updateStatus(title, description) {
    warningTextEl.textContent = title;
    statusTextEl.textContent = description;
  }

  function addMistake(message) {
    if (!state.mistakes.includes(message)) {
      state.mistakes.push(message);
    }
  }

  function coordKey(x, y) {
    return `${x},${y}`;
  }

  function parseCoord(key) {
    const [x, y] = key.split(",").map(Number);
    return { x, y };
  }

  function uniqueItems(items) {
    return [...new Set(items)];
  }

  function stopTimers() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }

    if (state.floodIntervalId) {
      clearInterval(state.floodIntervalId);
      state.floodIntervalId = null;
    }
  }

  init();
})();
