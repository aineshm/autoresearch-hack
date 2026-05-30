// ALFA UAV domain pack — the dataset we ALREADY HAVE for the one question we optimize for.
// Per the PRD: pack=alfa is the default. data_facts come from inspecting the operator's logs;
// crucially the logs CONTAIN the historical incidents (labeled), which is what we learn from.
export const ALFA_PACK = {
  name: 'alfa-uav',
  // Facts we (the Profiler) already know from the operator's flight logs — NEVER ask these.
  data_facts: {
    source: "the operator's own historical flight logs, already in hand (we are NOT collecting new data)",
    n_flights: 47,
    is_timeseries: true,
    channels: [
      'IMU: accel (ax,ay,az) + gyro (gx,gy,gz)',
      'attitude: roll / pitch / yaw (+ rates)',
      'airspeed (pitot)',
      'altitude + barometer',
      'GPS: lat/lon/alt + groundspeed',
      'throttle / motor',
      'control-surface COMMANDED vs ACTUAL (aileron, elevator, rudder)',
    ],
    labels: 'fault onset timestamp + fault type per flight (engine-failure and control-surface faults)',
    historical_incidents:
      'the logs ALREADY contain the 6 crashes + ~12 "mystery incidents" — these are the labeled, already-happened events we LEARN FROM to warn on future flights',
    leakage_hint: 'split by flight, never by window (windows from one flight leak across train/test)',
  },
  expertise_hint: 'fleet/operations user, not an ML practitioner — plain language + clickable answers',
  // angles worth probing (the question engine may use or ignore these)
  probe_hints: [
    'onset: sudden (seconds) vs gradual (minutes)',
    'cost of error: a missed incident vs a false alarm that grounds a drone',
    'which fault type worries them most (engine vs control-surface)',
  ],
};
