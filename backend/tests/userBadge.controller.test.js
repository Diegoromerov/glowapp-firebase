// backend/tests/userBadge.controller.test.js
const { list, create } = require('../src/controllers/userBadgeController');
const { UserBadge } = require('../src/models');

// Mock response helpers
function createRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

jest.mock('../src/models', () => ({
  UserBadge: {
    findAll: jest.fn(),
    create: jest.fn()
  }
}));

describe('UserBadgeController', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  test('list should return user badges', async () => {
    const mockBadges = [{ id: 1, badge_id: 2, user_id: 42 }];
    UserBadge.findAll.mockResolvedValue(mockBadges);
    const req = { user: { id: 42 } };
    const res = createRes();
    await list(req, res);
    expect(UserBadge.findAll).toHaveBeenCalledWith({ where: { user_id: 42 } });
    expect(res.json).toHaveBeenCalledWith(mockBadges);
  });

  test('create should add badge and return 201', async () => {
    const newBadge = { id: 10, badge_id: 5, user_id: 42 };
    UserBadge.create.mockResolvedValue(newBadge);
    const req = { user: { id: 42 }, body: { badge_id: 5 } };
    const res = createRes();
    await create(req, res);
    expect(UserBadge.create).toHaveBeenCalledWith({ user_id: 42, badge_id: 5 });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(newBadge);
  });

  test('create should validate missing badge_id', async () => {
    const req = { user: { id: 42 }, body: {} };
    const res = createRes();
    await create(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'badge_id is required' });
  });
});
