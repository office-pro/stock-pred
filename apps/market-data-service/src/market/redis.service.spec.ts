const mockSet = jest.fn();
const mockGet = jest.fn();
const mockOn = jest.fn();
const mockDisconnect = jest.fn();

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    set: mockSet,
    get: mockGet,
    on: mockOn,
    disconnect: mockDisconnect,
  })),
);

import { RedisService } from './redis.service';

describe('RedisService Stage 1', () => {
  beforeEach(() => {
    mockSet.mockReset();
    mockGet.mockReset();
    mockOn.mockReset();
    mockDisconnect.mockReset();
    mockOn.mockImplementation((event: string, cb: () => void) => {
      if (event === 'ready') cb();
    });
  });

  it('SET uses EX 60 and GET returns parsed JSON', async () => {
    mockGet.mockResolvedValue(JSON.stringify({ price: 100 }));
    mockSet.mockResolvedValue('OK');
    const redis = new RedisService();
    await redis.setJson('stockpred:quote:TCS', { price: 100 });
    expect(mockSet).toHaveBeenCalledWith(
      'stockpred:quote:TCS',
      JSON.stringify({ price: 100 }),
      'EX',
      60,
    );
    await expect(redis.getJson<{ price: number }>('stockpred:quote:TCS')).resolves.toEqual({
      price: 100,
    });
  });

  it('GET miss and Redis errors return null (provider fallback)', async () => {
    mockGet.mockRejectedValue(new Error('redis down'));
    const redis = new RedisService();
    await expect(redis.getJson('stockpred:quote:TCS')).resolves.toBeNull();
  });

  it('unhealthy Redis skips GET/SET so provider fallback remains available', async () => {
    mockOn.mockImplementation((event: string, cb: () => void) => {
      if (event === 'error') cb();
    });
    const redis = new RedisService();
    await redis.setJson('stockpred:quote:TCS', { price: 1 });
    expect(mockSet).not.toHaveBeenCalled();
    await expect(redis.getJson('stockpred:quote:TCS')).resolves.toBeNull();
    expect(mockGet).not.toHaveBeenCalled();
  });
});
