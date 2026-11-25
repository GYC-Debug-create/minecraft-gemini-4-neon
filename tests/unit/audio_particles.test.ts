import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../src/core/events';
import { AudioEngine } from '../../src/engine/AudioEngine';
import { ParticleSystem } from '../../src/engine/ParticleSystem';
import { BlockId } from '../../src/registry/blocks';

describe('M8 AudioEngine & ParticleSystem', () => {
  it('AudioEngine clamps volume and safely handles all sound cues in headless/node environment', () => {
    const events = new EventBus();
    const audio = new AudioEngine(events);

    audio.setVolume(1.5);
    expect(audio.getVolume()).toBe(1);
    audio.setVolume(-0.3);
    expect(audio.getVolume()).toBe(0);
    audio.setVolume(0.75);
    expect(audio.getVolume()).toBe(0.75);

    const names = ['dig', 'break', 'place', 'step', 'splash', 'hit', 'hurt', 'bow', 'eat', 'pickup', 'door', 'craft', 'ui'];
    for (const name of names) {
      expect(() => events.emit('sound:play', { name, volume: 0.8, pitch: 1.0 })).not.toThrow();
    }
    audio.dispose();
  });

  it('ParticleSystem spawns dig/break/splash/ember bursts, enforces pool cap, and ages particles out cleanly', () => {
    const events = new EventBus();
    const scene = new THREE.Scene();
    const particles = new ParticleSystem(scene, events);

    expect(particles.getActiveCount()).toBe(0);

    events.emit('particles:burst', { pos: { x: 0, y: 10, z: 0 }, blockId: BlockId.Stone, kind: 'break', count: 14 });
    events.emit('particles:burst', { pos: { x: 1, y: 10, z: 0 }, kind: 'splash', count: 10 });
    expect(particles.getActiveCount()).toBe(24);

    // Step simulation briefly: particles stay active
    particles.update(0.1);
    expect(particles.getActiveCount()).toBe(24);

    // Pool cap holds at <= 256 even under burst spam
    for (let i = 0; i < 40; i++) {
      particles.burst({ x: 0, y: 5, z: 0 }, 'dig', BlockId.OakLog, undefined, 12);
    }
    expect(particles.getActiveCount()).toBeLessThanOrEqual(256);

    // After 1.5s all short-lived particles expire to 0
    for (let i = 0; i < 15; i++) {
      particles.update(0.1);
    }
    expect(particles.getActiveCount()).toBe(0);

    particles.dispose();
  });
});
