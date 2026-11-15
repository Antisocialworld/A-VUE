import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../env.js';
import * as redisModule from '../lib/redis.js';
import { checkInWaitingRoom, getWaitingRoomStatus } from '../lib/waitingRoom.js';

describe('Waiting Room Atomic Check-in & Contract (Task A, B, C)', () => {
  const waitingRoomPath = path.resolve(__dirname, '../lib/waitingRoom.ts');
  const showtimesRoutePath = path.resolve(__dirname, '../routes/showtimes.ts');

  const waitingRoomSrc = fs.readFileSync(waitingRoomPath, 'utf-8');
  const showtimesRouteSrc = fs.readFileSync(showtimesRoutePath, 'utf-8');

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ============================================================================
  // SOURCE-TEXT CONTRACT ASSERTIONS
  // ============================================================================
  describe('Source-text Contract Assertions (Task C)', () => {
    it('uses exactly one atomic Redis Lua script executed via a single EVAL', () => {
      expect(waitingRoomSrc).toContain('const CHECK_IN_LUA = `');
      expect(waitingRoomSrc).toContain('await redis.eval(');

      // Verify no other eval calls exist in waitingRoom.ts
      const evalMatches = waitingRoomSrc.match(/redis\.eval\(/g);
      expect(evalMatches).not.toBeNull();
      expect(evalMatches!.length).toBe(1);
    });

    it('cleans up stale active entries inside the Lua script', () => {
      expect(waitingRoomSrc).toContain('cutoff = now - slotMs');
      expect(waitingRoomSrc).toContain('redis.call("HGETALL", activeKey)');
      expect(waitingRoomSrc).toContain('redis.call("HDEL", activeKey, uid)');
      expect(waitingRoomSrc).toContain('Remove stale active entries (older than slotSeconds)');
    });

    it('the hold route calls checkInWaitingRoom and no separate hlen/zcard check-then-write remains', () => {
      // Hold route calls checkInWaitingRoom
      expect(showtimesRouteSrc).toContain('checkInWaitingRoom(showtimeId, user.id)');
      expect(showtimesRouteSrc).not.toContain('isAdmittedOrRoomInactive');

      // No separate hlen or zcard check-then-write in waitingRoom.ts or showtimes.ts
      expect(waitingRoomSrc).not.toContain('redis.hlen');
      expect(waitingRoomSrc).not.toContain('redis.zcard');
      expect(waitingRoomSrc).not.toContain('isAdmittedOrRoomInactive');
      expect(showtimesRouteSrc).not.toContain('hlen');
      expect(showtimesRouteSrc).not.toContain('zcard');
    });

    it('returns queue position and estimated wait time when queued', () => {
      expect(waitingRoomSrc).toContain("position = (rank and (rank + 1)) or 1");
      expect(waitingRoomSrc).toContain("return { \"queued\", position }");
      expect(waitingRoomSrc).toContain('Math.ceil(position / admitPerSec)');
    });

    it('returns opaque random pass via crypto.randomBytes without checking or storing pass keys', () => {
      expect(waitingRoomSrc).toContain("crypto.randomBytes(16).toString('hex')");
      // Per-user pass keys are no longer written or checked
      expect(waitingRoomSrc).not.toContain(':pass:');
      expect(waitingRoomSrc).not.toContain('redis.set(');
      expect(waitingRoomSrc).not.toContain('redis.get(');
    });

    it('delegates getWaitingRoomStatus directly to checkInWaitingRoom without duplicating logic', () => {
      expect(waitingRoomSrc).toContain('return checkInWaitingRoom(showtimeId, userId);');
    });

    it('contains zero Math.random across waitingRoom.ts and showtimes.ts', () => {
      expect(waitingRoomSrc).not.toContain('Math.random');
      expect(showtimesRouteSrc).not.toContain('Math.random');
    });

    it('contains zero hashing (no createHash, sha256, sha1, argon2) in waitingRoom.ts', () => {
      expect(waitingRoomSrc).not.toContain('createHash');
      expect(waitingRoomSrc).not.toContain('sha256');
      expect(waitingRoomSrc).not.toContain('sha1');
      expect(waitingRoomSrc).not.toContain('argon2');
    });
  });

  // ============================================================================
  // FUNCTIONAL UNIT TESTS (Mocked Redis)
  // ============================================================================
  describe('Functional Unit Tests with Mocked Redis', () => {
    it('returns admitted status with 32-character hex pass token when Lua admits caller', async () => {
      const mockRedis = {
        status: 'ready',
        eval: vi.fn().mockResolvedValue(['admitted', 0]),
      };
      vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(mockRedis as any);

      const status = await checkInWaitingRoom('showtime-101', 'user-alpha');

      expect(mockRedis.eval).toHaveBeenCalledWith(
        expect.stringContaining('HGETALL'),
        2,
        'wr:showtime-101:active',
        'wr:showtime-101:queue',
        'user-alpha',
        expect.any(String), // now
        expect.any(String), // activeLimit
        expect.any(String), // slotSeconds
      );

      expect(status.status).toBe('admitted');
      expect(status.pass).toBeDefined();
      expect(typeof status.pass).toBe('string');
      expect(status.pass!.length).toBe(32);
      expect(status.position).toBeUndefined();
    });

    it('returns queued status with position and estimated wait time when Lua queues caller', async () => {
      const mockRedis = {
        status: 'ready',
        eval: vi.fn().mockResolvedValue(['queued', 7]),
      };
      vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(mockRedis as any);

      const status = await checkInWaitingRoom('showtime-101', 'user-beta');

      expect(status.status).toBe('queued');
      expect(status.position).toBe(7);
      expect(status.estimatedWaitSeconds).toBe(Math.ceil(7 / env.WAITING_ROOM_ADMIT_PER_SEC));
      expect(status.pass).toBeUndefined();
    });

    it('getWaitingRoomStatus returns identical payload by delegating to checkInWaitingRoom', async () => {
      const mockRedis = {
        status: 'ready',
        eval: vi.fn().mockResolvedValue(['queued', 3]),
      };
      vi.spyOn(redisModule, 'getRedisClient').mockReturnValue(mockRedis as any);

      const status = await getWaitingRoomStatus('showtime-101', 'user-gamma');
      expect(status.status).toBe('queued');
      expect(status.position).toBe(3);
      expect(status.estimatedWaitSeconds).toBe(1);
    });
  });
});
