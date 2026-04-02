export function playSuccessTone(audioContextRef) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;

  if (!AudioContextClass) {
    return;
  }

  let context = audioContextRef.current;

  if (!context || context.state === 'closed') {
    context = new AudioContextClass();
    audioContextRef.current = context;
  }

  const oscillatorA = context.createOscillator();
  const oscillatorB = context.createOscillator();
  const gain = context.createGain();
  const now = context.currentTime;

  oscillatorA.type = 'square';
  oscillatorB.type = 'square';
  oscillatorA.frequency.setValueAtTime(1046, now);
  oscillatorA.frequency.setValueAtTime(1318, now + 0.09);
  oscillatorB.frequency.setValueAtTime(1567, now);
  oscillatorB.frequency.setValueAtTime(2093, now + 0.09);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.07, now + 0.09);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);

  oscillatorA.connect(gain);
  oscillatorB.connect(gain);
  gain.connect(context.destination);
  oscillatorA.start(now);
  oscillatorB.start(now);
  oscillatorA.stop(now + 0.22);
  oscillatorB.stop(now + 0.22);
}
