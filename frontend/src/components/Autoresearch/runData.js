// The recorded ALFA UAV autoresearch run, distilled for the demo UI. All numbers are the real
// output from the swarm run; the UI animates this (no live experiments run during the demo).

export const RUN = {
  dataset: {
    flights: 47,
    split: { train: 30, val: 7, test: 10 },
    faultTypes: ['engine_failure', 'elevator_failure', 'aileron_failure', 'rudder_failure'],
    baseline: { f1: 0.0, far: 0.0, latency: 'never fired' },
  },
  spec: {
    task: 'Binary anomaly detection on UAV sensor time-series',
    metrics: ['event_level_F1 (maximize)', 'detection_latency_ms (minimize)'],
    gate: 'false_alarm_rate ≤ 2.0 / flight-hour',
    budget: 24,
    searchSpace: {
      window_length: [30, 50, 62, 75, 100],
      feature_set: ['residuals_only', 'residuals_plus_derivatives'],
      model_type: ['threshold', 'isolation_forest'],
      normalization: ['per_flight', 'global'],
      threshold_method: ['adaptive_3sigma', 'percentile_99'],
    },
  },
  // Each round: L3 decision + insight + the experiments it dispatched.
  rounds: [
    {
      n: 1, decision: 'EXPLORE',
      insight: 'First round — seed configs from domain priors. Residual features + short windows are the expected best start for actuator-fault detection.',
      experiments: [
        { id: '7a7971c4', f1: 0.667, far: 0.0, lat: 1269, gate: 'PASS', window: 30, feat: 'residuals_only' },
        { id: '43db5a3f', f1: 0.667, far: 0.0, lat: 1403, gate: 'PASS', window: 50, feat: 'residuals_only' },
        { id: 'fee729d8', f1: 0.667, far: 0.0, lat: 976, gate: 'PASS', window: 50, feat: 'residuals_only' },
        { id: 'f6839c0e', f1: 0.667, far: 0.0, lat: 1456, gate: 'PASS', window: 75, feat: 'residuals_only' },
        { id: '32139d10', f1: 0.500, far: 0.0, lat: 1089, gate: 'PASS', window: 30, feat: 'residuals_plus_derivatives' },
        { id: '4e291d85', f1: 0.667, far: 0.0, lat: 1852, gate: 'PASS', window: 50, feat: 'residuals_only' },
        { id: '7a8dc8ba', f1: 0.286, far: 0.0, lat: 764, gate: 'PASS', window: 30, feat: 'residuals_only' },
      ],
    },
    {
      n: 2, decision: 'EXPLORE',
      insight: "adaptive_3sigma + residuals_only consistently passes the gate but F1 is plateauing at 0.667. percentile_99 underperforms; residuals_plus_derivatives not fully explored.",
      experiments: [
        { id: '80403b01', f1: 0.500, far: 0.0, lat: 1431, gate: 'PASS', window: 62, feat: 'residuals_plus_derivatives' },
        { id: '644055b1', f1: 0.667, far: 0.0, lat: 629, gate: 'PASS', window: 100, feat: 'residuals_plus_derivatives' },
        { id: 'f255bac5', f1: 0.667, far: 0.0, lat: 1882, gate: 'PASS', window: 62, feat: 'residuals_only' },
        { id: '86f5fd8e', f1: 0.667, far: 0.0, lat: 3101, gate: 'PASS', window: 100, feat: 'residuals_plus_derivatives' },
        { id: '6ca1aeec', f1: 0.667, far: 0.0, lat: 629, gate: 'PASS', window: 75, feat: 'residuals_plus_derivatives' },
        { id: 'd732147f', f1: 0.667, far: 0.0, lat: 3018, gate: 'PASS', window: 100, feat: 'residuals_only' },
      ],
    },
    {
      n: 3, decision: 'EXPLORE',
      insight: 'F1 still plateauing at 0.667; latency varies widely (room to optimize). Probing percentile_99 + isolation_forest across windows.',
      experiments: [
        { id: '7beb6602', f1: 0.667, far: 0.0, lat: 1498, gate: 'PASS', window: 30, feat: 'residuals_plus_derivatives' },
        { id: 'b22d999c', f1: 0.667, far: 273.14, lat: 1478, gate: 'FAIL', window: 50, feat: 'residuals_plus_derivatives' },
        { id: '3835d2ad', f1: 0.667, far: 0.0, lat: 2219, gate: 'PASS', window: 62, feat: 'residuals_only' },
        { id: '8810eafb', f1: 0.667, far: 0.0, lat: 2421, gate: 'PASS', window: 75, feat: 'residuals_only' },
        { id: 'dad7d99d', f1: 0.286, far: 0.0, lat: 987, gate: 'PASS', window: 100, feat: 'residuals_plus_derivatives' },
        { id: '4c33cdc9', f1: 0.500, far: 0.0, lat: 348, gate: 'PASS', window: 50, feat: 'residuals_plus_derivatives' },
      ],
    },
    {
      n: 4, decision: 'EXPLOIT',
      insight: 'Lock onto adaptive_3sigma; push short windows + residuals_only. This is where the breakthrough lands.',
      experiments: [
        { id: '74f8dcd5', f1: 0.667, far: 0.0, lat: 1959, gate: 'PASS', window: 62, feat: 'residuals_plus_derivatives' },
        { id: 'ae75a393', f1: 0.500, far: 0.0, lat: 1525, gate: 'PASS', window: 75, feat: 'residuals_plus_derivatives' },
        { id: '9191da92', f1: 0.286, far: 0.0, lat: 1114, gate: 'PASS', window: 100, feat: 'residuals_only' },
        { id: 'db29c56f', f1: 0.286, far: 0.0, lat: 1912, gate: 'PASS', window: 75, feat: 'residuals_only' },
        { id: '50697a79', f1: 0.800, far: 0.0, lat: 1220, gate: 'PASS', window: 30, feat: 'residuals_only', best: true },
      ],
    },
  ],
  final: {
    experiments: 24, passed: 23, failed: 1,
    best: {
      window_length: 30, feature_set: 'residuals_only', model_type: 'isolation_forest',
      normalization: 'global', threshold_method: 'adaptive_3sigma', channel_weights: 'uniform',
      f1: 0.800, far: 0.0, latency: 1220,
    },
    baseline: { f1: 0.0 },
    learned: [
      'Adaptive threshold is essential — the default fixed threshold never fires (F1=0.000); adaptive_3sigma calibrates to the training distribution and reaches F1=0.800.',
      'Optimal window is 30 timesteps — shorter windows win because fault onset is sharp; no long averaging needed.',
      'Residual features beat residuals+derivatives here; the extra channels added noise, not signal.',
    ],
    limits: [
      'left_aileron + right_aileron failure: recall 0.00 (misses 100% of these). Fix: a fault-type-specific (MoE) detector or a dedicated loop for this fault class.',
    ],
  },
  replay: {
    flight: 'carbonZ_2018-09-11-11-56-30_engine_failure',
    faultType: 'engine_failure',
    onset: 103.57,
    threshold: 0.5555,
    detected: { time: 104.01, latency: 437, score: 0.5624, speed: 21.2, throttle: 0.0 },
    // [t, speed(m/s), throttle, altDelta(m), anomaly score]
    series: [
      [0.0, 20.9, 0.04, 0, 0.0], [1.6, 20.5, 0.06, -9.4, 0.5677], [3.3, 21.7, 0.02, -17.8, 0.5808],
      [4.8, 21.8, 0.09, -25.9, 0.5872], [7.3, 23.0, 0.51, -40.3, 0.5851], [9.5, 23.8, 0.64, -41.0, 0.5026],
      [11.1, 18.4, 0.30, -31.6, 0.5335], [13.3, 17.5, 0.36, -32.9, 0.4334], [16.4, 18.2, 0.39, -34.9, 0.3719],
      [20.2, 17.9, 0.45, -37.3, 0.3527], [25.0, 17.7, 0.48, -38.2, 0.3748], [30.4, 20.0, 0.44, -36.7, 0.4440],
      [31.2, 18.8, 0.32, -34.4, 0.5088], [35.1, 19.3, 0.35, -36.4, 0.4103], [40.4, 21.4, 0.63, -40.8, 0.3986],
      [43.5, 17.1, 0.32, -35.7, 0.4942], [44.4, 15.9, 0.25, -34.0, 0.5404], [48.1, 18.0, 0.50, -40.3, 0.3880],
      [55.2, 16.7, 0.46, -38.5, 0.3462], [62.3, 16.3, 0.50, -38.5, 0.3704], [70.0, 15.2, 0.42, -37.7, 0.3513],
      [77.1, 16.4, 0.49, -38.6, 0.3663], [85.0, 16.5, 0.44, -38.1, 0.3756], [92.1, 17.0, 0.40, -37.2, 0.3709],
      [98.4, 16.2, 0.43, -37.5, 0.3902], [100.7, 18.3, 0.58, -39.8, 0.4109], [102.3, 22.1, 0.72, -42.3, 0.4379],
      [103.0, 22.5, 0.71, -42.1, 0.4369], [103.8, 21.2, 0.0, -40.5, 0.5287], [104.01, 21.2, 0.0, -40.5, 0.5624],
      [104.5, 18.4, 0.0, -38.1, 0.6240], [106.0, 15.7, 0.0, -35.3, 0.6054], [107.6, 16.2, 0.0, -38.0, 0.5526],
      [109.2, 15.9, 0.0, -40.1, 0.5797], [111.4, 13.7, 0.0, -41.1, 0.5124], [113.8, 12.4, 0.0, -42.3, 0.5454],
      [116.1, 12.6, 0.0, -46.7, 0.6149], [117.6, 12.8, 0.0, -50.5, 0.6498], [119.2, 11.4, 0.0, -55.8, 0.5919],
      [121.5, 10.9, 0.0, -62.6, 0.5734], [123.9, 11.1, 0.0, -70.0, 0.5809],
    ],
  },
};
