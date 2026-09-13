import { describe, expect, test } from 'bun:test';
import { defaultFriends } from './data';
import { getParticipatingFriends, MAX_SAVED_FRIENDS, parseSavedPlan } from './plan';
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

describe('saved friends and participation', () => {
  const makeFriends = (count: number): Friend[] =>
    Array.from({ length: count }, (_, index) => ({
      ...defaultFriends[index % defaultFriends.length]!,
      id: `saved-friend-${index}`,
      enabled: index % 3 !== 0,
      travelMode: index % 2 === 0 ? 'driving' : 'transit',
      weight: index % 2 === 0 ? 0.5 : 2,
    }));

  test('restores larger address books through the fifty-friend limit without losing details', () => {
    expect(MAX_SAVED_FRIENDS).toBe(50);
    for (const count of [9, 30, MAX_SAVED_FRIENDS]) {
      const friends = makeFriends(count);
      expect(parseSavedPlan(JSON.stringify({ friends, strategy: 'fair' }))).toEqual({
        friends,
        strategy: 'fair',
      });
    }
    expect(
      parseSavedPlan(JSON.stringify({ friends: makeFriends(MAX_SAVED_FRIENDS + 1) })),
    ).toBeUndefined();
  });

  test('an empty or one-friend address book is a valid saved plan', () => {
    for (const count of [0, 1]) {
      const friends = makeFriends(count);
      expect(parseSavedPlan(JSON.stringify({ friends, strategy: 'total' }))).toEqual({
        friends,
        strategy: 'total',
      });
    }
  });

  test('older plans default to participating and transit while preserving their profile', () => {
    const friends = defaultFriends.map(({ enabled: _enabled, travelMode: _mode, ...friend }) => ({
      ...friend,
      weight: 0.5,
    }));
    const restored = parseSavedPlan(JSON.stringify({ friends }))!;
    expect(restored.friends).toEqual(
      friends.map((friend) => ({ ...friend, enabled: true, travelMode: 'transit' })),
    );
    expect(getParticipatingFriends(friends)).toEqual(friends);
  });

  test('only a boolean false opts out and invalid participation values fall back to true', () => {
    const values = [false, true, undefined, null, 0, 1, '', 'false', [], {}];
    const friends = values.map((enabled, index) => ({
      ...defaultFriends[0]!,
      id: `participation-${index}`,
      enabled,
      travelMode: 'driving' as const,
      weight: 0.2,
    }));
    const restored = parseSavedPlan(JSON.stringify({ friends }))!;
    expect(restored.friends).toEqual(
      friends.map((friend) => ({ ...friend, enabled: friend.enabled !== false })),
    );
    expect(getParticipatingFriends(restored.friends).map((friend) => friend.id)).toEqual(
      friends.slice(1).map((friend) => friend.id),
    );
    expect(restored.friends[0]!.enabled).toBe(false);
  });

  test('reselecting a saved friend restores their profile without modifying the address book', () => {
    const friends = makeFriends(9);
    const saved = JSON.stringify({ friends, strategy: 'balanced' });
    const restored = parseSavedPlan(saved)!;
    const participating = getParticipatingFriends(restored.friends);
    expect(participating).toHaveLength(6);
    expect(restored.friends).toHaveLength(9);
    expect(JSON.stringify({ friends: restored.friends, strategy: restored.strategy })).toBe(saved);
    const reselected = restored.friends.map((friend) => ({ ...friend, enabled: true }));
    expect(getParticipatingFriends(reselected)).toEqual(
      friends.map((friend) => ({ ...friend, enabled: true })),
    );
  });
});
