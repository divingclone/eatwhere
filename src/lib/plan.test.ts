import { describe, expect, test } from 'bun:test';
import { defaultFriends } from './data';
import { parseSavedPlan } from './plan';
import type { Friend } from './types';

describe('saved travel modes', () => {
  test('preserves an older plan and supplies transit for a missing mode', () => {
    const oldFriends = defaultFriends.map(({ travelMode: _mode, ...friend }) => friend);
    const restored = parseSavedPlan(JSON.stringify({ friends: oldFriends, strategy: 'fair' }))!;
    expect(restored.strategy).toBe('fair');
    expect(restored.friends.map((friend) => friend.travelMode)).toEqual([
      'transit',
      'transit',
      'transit',
    ]);
    expect(restored.friends.map((friend) => friend.location)).toEqual(
      oldFriends.map((friend) => friend.location),
    );
  });

  test('restores mixed travel modes and original weights', () => {
    const friends: Friend[] = defaultFriends.map((friend, index) => ({
      ...friend,
      travelMode: index === 0 ? 'driving' : 'transit',
      weight: index === 0 ? 0.5 : 1,
    }));
    expect(parseSavedPlan(JSON.stringify({ friends, strategy: 'total' }))?.friends).toEqual(
      friends,
    );
  });

  test('invalid modes fall back to transit without discarding addresses', () => {
    const friends = defaultFriends.map((friend) => ({ ...friend, travelMode: 'flying' }));
    const restored = parseSavedPlan(JSON.stringify({ friends }))!;
    expect(restored.friends.every((friend) => friend.travelMode === 'transit')).toBe(true);
    expect(restored.friends[0]!.address).toBe(friends[0]!.address);
  });

  test('malformed or duplicate friend plans remain rejected', () => {
    expect(parseSavedPlan('{bad')).toBeUndefined();
    expect(parseSavedPlan(null)).toBeUndefined();
    expect(parseSavedPlan(JSON.stringify({ friends: [null, null] }))).toBeUndefined();
    expect(
      parseSavedPlan(JSON.stringify({ friends: [defaultFriends[0], defaultFriends[0]] })),
    ).toBeUndefined();
  });
});
