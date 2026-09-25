import { describe, expect, it } from 'vitest';
import { goodNewsSpeechDrawsRand } from './speech-rand.ts';

describe('0x44f230 那一次 rand：50 < 點數 ≤ 100', () => {
  it('边界', () => {
    expect(goodNewsSpeechDrawsRand(50)).toBe(false);
    expect(goodNewsSpeechDrawsRand(51)).toBe(true);
    expect(goodNewsSpeechDrawsRand(100)).toBe(true);
    expect(goodNewsSpeechDrawsRand(101)).toBe(false);
  });
});
