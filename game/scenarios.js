(function () {
  const INTRO_STEPS = [
    {
      title: "Flood Warning Incoming",
      description:
        "Heavy rain has been reported nearby. Your goal is to move through the neighborhood and reach higher ground before the flood becomes severe."
    },
    {
      title: "Read The Area Like A Real Street",
      description:
        "Roads are passable, houses are blocked, low areas flood early, and safe zones sit on higher ground. You cannot walk through buildings."
    },
    {
      title: "Water Spreads With Delay",
      description:
        "Floodwater does not jump everywhere at once. It starts at risky blocks and spreads tile by tile every few seconds, creating uncertainty as conditions change."
    }
  ];

  const LEVELS = [
    {
      id: 1,
      name: "Neighborhood Start",
      intro:
        "A flood alert has just started. Reach the school terrace shelter while streets are still mostly open.",
      waterRisePerSecond: 2,
      floodSpreadDelay: 3000,
      criticalWaterLevel: 20,
      lowScoreThreshold: -30,
      start: { x: 0, y: 9 },
      goal: { x: 9, y: 0 },
      map: [
        ["road", "road", "house", "house", "road", "road", "low", "safe", "safe", "safe"],
        ["road", "house", "house", "road", "road", "low", "low", "safe", "safe", "safe"],
        ["road", "road", "road", "road", "low", "low", "road", "road", "road", "safe"],
        ["house", "house", "road", "road", "low", "house", "road", "house", "road", "road"],
        ["road", "road", "road", "low", "low", "road", "road", "road", "road", "road"],
        ["road", "house", "road", "low", "house", "road", "house", "house", "road", "road"],
        ["road", "road", "road", "road", "road", "road", "road", "road", "road", "road"],
        ["road", "house", "road", "low", "low", "road", "house", "road", "road", "road"],
        ["road", "road", "road", "low", "road", "road", "road", "road", "house", "road"],
        ["road", "house", "road", "road", "road", "house", "road", "road", "road", "road"]
      ],
      floodSources: [
        { x: 3, y: 8 },
        { x: 6, y: 1 }
      ],
      scenarios: {
        "2,8": {
          title: "Flooded Shortcut",
          description:
            "A road through the market is holding water. It looks passable from far away, but the depth is unclear.",
          choices: [
            {
              label: "Take the shortcut before it gets worse",
              score: -12,
              waterDelta: 2,
              status:
                "That risky shortcut saved distance but increased your exposure to hidden danger.",
              mistake:
                "You crossed a road with standing floodwater instead of avoiding it."
            },
            {
              label: "Take the longer dry road",
              score: 10,
              status:
                "Using a dry route is usually safer than testing unknown flood depth.",
              tip:
                "Avoid walking or driving into floodwater when a safe route is available."
            }
          ]
        },
        "5,6": {
          title: "Elderly Neighbor Waiting",
          description:
            "An older resident is unsure whether to leave now or wait another few minutes for the rain to slow.",
          choices: [
            {
              label: "Tell them to move now toward higher ground",
              score: 12,
              status:
                "Early evacuation helps people who need more time before roads worsen.",
              tip:
                "Check on older adults and anyone who may need help moving during flood alerts."
            },
            {
              label: "Suggest waiting to see what happens",
              score: -10,
              waterDelta: 2,
              status:
                "Waiting can reduce the time available for safe evacuation.",
              mistake:
                "You encouraged delay when early movement was safer."
            }
          ]
        }
      }
    },
    {
      id: 2,
      name: "School Route Under Pressure",
      intro:
        "Rain intensifies and more low blocks begin collecting water. Reach the hill shelter as flooded roads start cutting off options.",
      waterRisePerSecond: 3,
      floodSpreadDelay: 2600,
      criticalWaterLevel: 24,
      lowScoreThreshold: -28,
      start: { x: 0, y: 8 },
      goal: { x: 9, y: 1 },
      map: [
        ["road", "road", "house", "road", "road", "low", "safe", "safe", "safe", "safe"],
        ["road", "house", "house", "road", "low", "low", "road", "road", "road", "safe"],
        ["road", "road", "road", "road", "low", "house", "road", "house", "road", "road"],
        ["house", "house", "road", "road", "road", "road", "road", "house", "road", "road"],
        ["road", "road", "road", "low", "low", "road", "house", "road", "road", "road"],
        ["road", "house", "road", "low", "house", "road", "road", "road", "house", "road"],
        ["road", "road", "road", "road", "road", "road", "low", "road", "road", "road"],
        ["road", "house", "road", "house", "road", "road", "low", "low", "road", "road"],
        ["road", "road", "road", "road", "road", "house", "road", "road", "road", "road"],
        ["house", "house", "road", "road", "road", "road", "road", "house", "road", "road"]
      ],
      floodSources: [
        { x: 5, y: 0 },
        { x: 7, y: 7 }
      ],
      scenarios: {
        "3,4": {
          title: "Children Still Outside",
          description:
            "Two children are playing near a lane where water is beginning to move faster toward a drain.",
          choices: [
            {
              label: "Warn them and guide them to a higher path",
              score: 14,
              status:
                "Removing children from moving water is a strong safety decision.",
              tip:
                "Keep children away from floodwater, drains, and fast-moving runoff."
            },
            {
              label: "Assume an adult nearby will handle it",
              score: -11,
              status:
                "Not acting quickly can leave others exposed to sudden changes in water flow.",
              mistake:
                "You left children near moving floodwater without warning them."
            }
          ]
        },
        "6,6": {
          title: "Scooter On A Flooded Edge",
          description:
            "A neighbor wants to ride a scooter through a partially flooded lane to save time.",
          choices: [
            {
              label: "Tell them to leave the scooter and walk to shelter by a dry route",
              score: 12,
              status:
                "Vehicles can stall or slip in floodwater, even when it looks shallow.",
              tip:
                "Do not try to drive or ride through floodwater if road condition is uncertain."
            },
            {
              label: "Suggest going slowly through the water",
              score: -13,
              waterDelta: 1,
              status:
                "Slow movement does not remove the risk of hidden potholes or current.",
              mistake:
                "You encouraged travel through unclear floodwater."
            }
          ]
        }
      }
    },
    {
      id: 3,
      name: "Night Evacuation",
      intro:
        "Visibility is lower now and water is entering more streets. You need to reach a raised clinic access point before the route closes.",
      waterRisePerSecond: 4,
      floodSpreadDelay: 2300,
      criticalWaterLevel: 28,
      lowScoreThreshold: -26,
      start: { x: 1, y: 9 },
      goal: { x: 8, y: 0 },
      map: [
        ["house", "road", "road", "low", "road", "road", "safe", "safe", "safe", "house"],
        ["road", "road", "house", "low", "low", "house", "road", "road", "road", "road"],
        ["road", "house", "road", "road", "road", "road", "road", "house", "road", "road"],
        ["road", "road", "road", "house", "low", "low", "road", "road", "road", "house"],
        ["house", "house", "road", "road", "low", "road", "road", "house", "road", "road"],
        ["road", "road", "road", "road", "road", "road", "low", "road", "road", "road"],
        ["road", "house", "road", "house", "road", "road", "low", "low", "road", "house"],
        ["road", "road", "road", "road", "road", "house", "road", "road", "road", "road"],
        ["house", "house", "road", "low", "road", "road", "road", "house", "road", "road"],
        ["road", "road", "road", "road", "house", "road", "road", "road", "road", "house"]
      ],
      floodSources: [
        { x: 3, y: 0 },
        { x: 7, y: 6 }
      ],
      scenarios: {
        "2,5": {
          title: "Torch Or Phone Battery",
          description:
            "A family has one flashlight and one nearly dead phone. They ask what they should save for the evacuation.",
          choices: [
            {
              label: "Save both if possible, but prioritize communication and light efficiently",
              score: 14,
              status:
                "Managing light and communication helps with safe navigation and emergency contact.",
              tip:
                "Keep a charged phone and flashlight ready during heavy rain or flood alerts."
            },
            {
              label: "Use the phone for entertainment until the power goes out",
              score: -14,
              status:
                "Draining battery early can leave people without light or communication later.",
              mistake:
                "You treated battery power casually during an active flood emergency."
            }
          ]
        },
        "6,4": {
          title: "Electric Meter Near Water",
          description:
            "Water is moving toward a wall meter box. Residents are nervous and want to touch it quickly before it gets wet.",
          choices: [
            {
              label: "Keep them away and call for trained help if it is unsafe",
              score: 16,
              status:
                "Electrical equipment near water should be handled carefully or left to trained responders.",
              tip:
                "Stay away from electrical installations near water unless the shutdown point is clearly safe."
            },
            {
              label: "Tell them to grab it quickly before the water rises more",
              score: -16,
              waterDelta: 2,
              status:
                "Rushing into an electrical hazard during flooding can be life-threatening.",
              mistake:
                "You encouraged unsafe contact with electrical equipment near water."
            }
          ]
        }
      }
    },
    {
      id: 4,
      name: "Critical Surge",
      intro:
        "This is the hardest route. Water is rising quickly, spread delay is shorter, and one bad route choice can trap you before you reach the final shelter ridge.",
      waterRisePerSecond: 5,
      floodSpreadDelay: 2000,
      criticalWaterLevel: 30,
      lowScoreThreshold: -24,
      start: { x: 0, y: 9 },
      goal: { x: 9, y: 0 },
      map: [
        ["road", "low", "road", "house", "road", "safe", "safe", "safe", "road", "safe"],
        ["road", "low", "house", "house", "road", "low", "road", "road", "road", "road"],
        ["road", "road", "road", "road", "road", "low", "house", "house", "road", "road"],
        ["house", "house", "road", "low", "road", "road", "road", "road", "road", "house"],
        ["road", "road", "road", "low", "house", "house", "low", "road", "road", "road"],
        ["road", "house", "road", "road", "road", "road", "low", "house", "road", "road"],
        ["road", "house", "road", "house", "road", "road", "road", "road", "road", "house"],
        ["road", "road", "road", "house", "road", "low", "low", "road", "road", "road"],
        ["low", "house", "road", "road", "road", "house", "road", "road", "house", "road"],
        ["road", "road", "road", "house", "road", "road", "road", "low", "road", "road"]
      ],
      floodSources: [
        { x: 1, y: 1 },
        { x: 6, y: 4 },
        { x: 7, y: 9 }
      ],
      scenarios: {
        "4,2": {
          title: "Return For Documents?",
          description:
            "Someone asks if they should turn back into a worsening area to collect documents left at home.",
          choices: [
            {
              label: "Take only essential items already in hand and keep moving",
              score: 15,
              status:
                "When time is short, protecting life comes before returning for property.",
              tip:
                "Keep ID, medicines, water, and essential contacts ready in one easy-to-carry bag."
            },
            {
              label: "Go back quickly before the road closes",
              score: -15,
              waterDelta: 2,
              status:
                "Turning back during fast-rising flooding can remove the last safe exit.",
              mistake:
                "You prioritized belongings over immediate evacuation."
            }
          ]
        },
        "8,3": {
          title: "Rumor About A Better Route",
          description:
            "A passerby claims there is a shortcut through a dark side lane, but nobody has confirmed whether it is flooded.",
          choices: [
            {
              label: "Stay on the known route to the marked shelter",
              score: 13,
              status:
                "Sticking to verified routes reduces exposure to hidden flood hazards.",
              tip:
                "Follow confirmed evacuation routes instead of rumors during emergencies."
            },
            {
              label: "Take the unverified lane and hope it is faster",
              score: -14,
              status:
                "Unknown side streets can become dead ends or collect deeper water.",
              mistake:
                "You trusted an unverified shortcut during an emergency."
            }
          ]
        }
      }
    }
  ];

  const FLOOD_TIPS = [
    "Move to higher ground early when flood alerts are issued.",
    "Never walk or drive through floodwater if depth or current is unclear.",
    "Keep emergency contacts, medicines, and important documents ready.",
    "Stay away from electric lines, sockets, and appliances near water.",
    "Help children, older adults, and neighbors who may need more time to evacuate."
  ];

  const TILE_META = {
    road: { icon: "RD", label: "Road" },
    house: { icon: "🏠", label: "House" },
    low: { icon: "LOW", label: "Low Area" },
    safe: { icon: "SAFE", label: "Safe Zone" }
  };

  // Compute maximum possible scenario score across all levels
  const TOTAL_MAX_SCORE = LEVELS.reduce((total, level) => {
    const scenarioMax = Object.values(level.scenarios).reduce((sum, sc) => {
      const best = Math.max(...sc.choices.map((c) => c.score));
      return sum + (best > 0 ? best : 0);
    }, 0);
    return total + scenarioMax;
  }, 0);

  window.FloodScenarios = {
    INTRO_STEPS,
    LEVELS,
    FLOOD_TIPS,
    TILE_META,
    TOTAL_MAX_SCORE
  };
})();
