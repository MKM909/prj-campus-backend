const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const ids = {
  chat: '11111111-1111-4111-8111-111111111111',
  sender: '22222222-2222-4222-8222-222222222222',
  recipient: '33333333-3333-4333-8333-333333333333',
  message: '44444444-4444-4444-8444-444444444444',
  community: '55555555-5555-4555-8555-555555555555',
  announcement: '66666666-6666-4666-8666-666666666666'
};

class FakeSupabase {
  constructor() {
    this.queues = new Map();
    this.calls = [];
  }

  enqueue(table, operation, result) {
    const key = `${table}:${operation}`;
    if (!this.queues.has(key)) this.queues.set(key, []);
    this.queues.get(key).push(result);
  }

  next(table, operation, call) {
    const key = `${table}:${operation}`;
    const queue = this.queues.get(key) || [];
    if (queue.length === 0) {
      throw new Error(`No fake Supabase result queued for ${key}`);
    }
    const result = queue.shift();
    return typeof result === 'function' ? result(call) : result;
  }

  from(table) {
    return new FakeQuery(this, table);
  }

  findCall(table, operation) {
    return this.calls.find((call) => call.table === table && call.operation === operation);
  }

  findCalls(table, operation) {
    return this.calls.filter((call) => call.table === table && call.operation === operation);
  }
}

class FakeQuery {
  constructor(db, table) {
    this.db = db;
    this.table = table;
    this.operation = null;
    this.payload = undefined;
    this.options = undefined;
    this.selected = undefined;
    this.filters = [];
    this.orders = [];
    this.limitValue = undefined;
  }

  select(columns, options) {
    if (!this.operation) this.operation = 'select';
    this.selected = columns;
    this.options = options;
    return this;
  }

  insert(payload) {
    this.operation = 'insert';
    this.payload = payload;
    return this;
  }

  update(payload) {
    this.operation = 'update';
    this.payload = payload;
    return this;
  }

  upsert(payload, options) {
    this.operation = 'upsert';
    this.payload = payload;
    this.options = options;
    return this;
  }

  delete() {
    this.operation = 'delete';
    return this;
  }

  eq(column, value) {
    this.filters.push(['eq', column, value]);
    return this;
  }

  neq(column, value) {
    this.filters.push(['neq', column, value]);
    return this;
  }

  in(column, value) {
    this.filters.push(['in', column, value]);
    return this;
  }

  is(column, value) {
    this.filters.push(['is', column, value]);
    return this;
  }

  gt(column, value) {
    this.filters.push(['gt', column, value]);
    return this;
  }

  lt(column, value) {
    this.filters.push(['lt', column, value]);
    return this;
  }

  lte(column, value) {
    this.filters.push(['lte', column, value]);
    return this;
  }

  order(column, options) {
    this.orders.push([column, options]);
    return this;
  }

  limit(value) {
    this.limitValue = value;
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.execute('maybeSingle'));
  }

  single() {
    return Promise.resolve(this.execute('single'));
  }

  then(resolve, reject) {
    try {
      return Promise.resolve(this.execute('then')).then(resolve, reject);
    } catch (error) {
      return Promise.reject(error).then(resolve, reject);
    }
  }

  execute(term) {
    const call = {
      table: this.table,
      operation: this.operation || 'select',
      payload: this.payload,
      options: this.options,
      selected: this.selected,
      filters: this.filters,
      orders: this.orders,
      limit: this.limitValue,
      term
    };
    this.db.calls.push(call);
    return this.db.next(this.table, call.operation, call);
  }
}

const loadController = (fakeSupabase) => {
  const controllerPath = path.resolve(__dirname, '../src/controllers/messageController.js');
  const supabasePath = path.resolve(__dirname, '../src/config/supabase.js');
  delete require.cache[controllerPath];
  require.cache[supabasePath] = {
    id: supabasePath,
    filename: supabasePath,
    loaded: true,
    exports: fakeSupabase
  };
  return require(controllerPath);
};

const mockReq = ({ params = {}, body = {}, query = {}, method = 'POST' } = {}) => ({
  params,
  body,
  query,
  method,
  user: { id: ids.sender }
});

const mockRes = () => ({
  statusCode: 200,
  body: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
  setHeader() {},
  flushHeaders() {},
  write() {},
  end() {}
});

const muteControllerErrors = async (fn) => {
  const original = console.error;
  console.error = () => {};
  try {
    await fn();
  } finally {
    console.error = original;
  }
};

test('sendMessage stores optimistic IDs, local reply refs, and app attachment fields', async () => {
  const supabase = new FakeSupabase();
  const controller = loadController(supabase);

  supabase.enqueue('chats', 'select', {
    data: { id: ids.chat, type: 'group', send_policy: 'all', disappearing_seconds: null },
    error: null
  });
  supabase.enqueue('chat_participants', 'select', {
    data: { chat_id: ids.chat, user_id: ids.sender, role: 'member', status: 'active', is_approved: true },
    error: null
  });
  supabase.enqueue('chat_messages', 'insert', (call) => ({
    data: { id: ids.message, ...call.payload[0] },
    error: null
  }));
  supabase.enqueue('chat_message_attachments', 'insert', { data: null, error: null });
  supabase.enqueue('chat_read_receipts', 'upsert', { data: null, error: null });
  supabase.enqueue('chats', 'update', { data: null, error: null });
  supabase.enqueue('chat_messages', 'select', {
    data: { id: ids.message, chat_id: ids.chat, chat_message_attachments: [] },
    error: null
  });

  const req = mockReq({
    params: { chatId: ids.chat },
    body: {
      id: 'local-1',
      clientMessageId: 'local-1',
      body: 'See attached',
      type: 'image',
      repliedToMessageId: 'local-parent',
      attachmentUrl: 'https://cdn.example/photo.jpg',
      attachmentName: 'photo.jpg',
      attachmentSize: '1.2 MB',
      fileHash: 'abc123'
    }
  });
  const res = mockRes();

  await controller.sendMessage(req, res);

  assert.equal(res.statusCode, 201);
  assert.equal(res.body.status, 'success');

  const messageInsert = supabase.findCall('chat_messages', 'insert').payload[0];
  assert.equal(messageInsert.client_message_id, 'local-1');
  assert.equal(messageInsert.reply_to_id, null);
  assert.equal(messageInsert.reply_to_client_message_id, 'local-parent');
  assert.equal(messageInsert.type, 'image');
  assert.equal(messageInsert.message_status, 'sent');

  const attachmentInsert = supabase.findCall('chat_message_attachments', 'insert').payload[0];
  assert.equal(attachmentInsert.cdn_url, 'https://cdn.example/photo.jpg');
  assert.equal(attachmentInsert.file_name, 'photo.jpg');
  assert.equal(attachmentInsert.file_size_label, '1.2 MB');
  assert.equal(attachmentInsert.file_hash, 'abc123');
});

test('sendMessage silently suppresses direct messages when recipient blocked sender', async () => {
  const supabase = new FakeSupabase();
  const controller = loadController(supabase);

  supabase.enqueue('chats', 'select', {
    data: { id: ids.chat, type: 'direct', send_policy: 'all', disappearing_seconds: null },
    error: null
  });
  supabase.enqueue('chat_participants', 'select', {
    data: { chat_id: ids.chat, user_id: ids.sender, role: 'member', status: 'active', is_approved: true },
    error: null
  });
  supabase.enqueue('chat_participants', 'select', {
    data: [{ user_id: ids.sender }, { user_id: ids.recipient }],
    error: null
  });
  supabase.enqueue('user_blocks', 'select', {
    data: [{ blocker_id: ids.recipient, blocked_id: ids.sender }],
    error: null
  });
  supabase.enqueue('chat_messages', 'insert', (call) => ({
    data: { id: ids.message, ...call.payload[0] },
    error: null
  }));
  supabase.enqueue('chat_read_receipts', 'upsert', { data: null, error: null });
  supabase.enqueue('chats', 'update', { data: null, error: null });
  supabase.enqueue('chat_messages', 'select', {
    data: { id: ids.message, chat_id: ids.chat, suppressed_for_user_ids: [ids.recipient] },
    error: null
  });

  const req = mockReq({
    params: { chatId: ids.chat },
    body: { clientMessageId: 'local-blocked', body: 'hello' }
  });
  const res = mockRes();

  await controller.sendMessage(req, res);

  assert.equal(res.statusCode, 201);
  const messageInsert = supabase.findCall('chat_messages', 'insert').payload[0];
  assert.deepEqual(messageInsert.suppressed_for_user_ids, [ids.recipient]);
});

test('sendMessage rejects non-admin posts in admin-only groups', async () => {
  const supabase = new FakeSupabase();
  const controller = loadController(supabase);

  supabase.enqueue('chats', 'select', {
    data: { id: ids.chat, type: 'group', send_policy: 'admins', disappearing_seconds: null },
    error: null
  });
  supabase.enqueue('chat_participants', 'select', {
    data: { chat_id: ids.chat, user_id: ids.sender, role: 'member', status: 'active', is_approved: true },
    error: null
  });

  const req = mockReq({
    params: { chatId: ids.chat },
    body: { clientMessageId: 'local-nope', body: 'I should not send' }
  });
  const res = mockRes();

  await muteControllerErrors(async () => {
    await controller.sendMessage(req, res);
  });

  assert.equal(res.statusCode, 403);
  assert.equal(supabase.findCalls('chat_messages', 'insert').length, 0);
});

test('updateReceipts upserts read receipts and advances direct chat message status', async () => {
  const supabase = new FakeSupabase();
  const controller = loadController(supabase);

  supabase.enqueue('chats', 'select', {
    data: { id: ids.chat, type: 'direct' },
    error: null
  });
  supabase.enqueue('chat_participants', 'select', {
    data: { chat_id: ids.chat, user_id: ids.sender, role: 'member', status: 'active', is_approved: true },
    error: null
  });
  supabase.enqueue('chat_messages', 'select', {
    data: [{ id: ids.message }],
    error: null
  });
  supabase.enqueue('chat_read_receipts', 'upsert', { data: null, error: null });
  supabase.enqueue('chat_messages', 'update', { data: null, error: null });
  supabase.enqueue('chat_participants', 'update', { data: null, error: null });

  const req = mockReq({
    params: { chatId: ids.chat },
    body: { status: 'read', messageIds: [ids.message] }
  });
  const res = mockRes();

  await controller.updateReceipts(req, res);

  assert.equal(res.statusCode, 200);
  const receipt = supabase.findCall('chat_read_receipts', 'upsert').payload[0];
  assert.equal(receipt.message_id, ids.message);
  assert.equal(receipt.user_id, ids.sender);
  assert.ok(receipt.delivered_at);
  assert.ok(receipt.read_at);

  const messageUpdate = supabase.findCall('chat_messages', 'update').payload;
  assert.equal(messageUpdate.message_status, 'read');
  assert.equal(messageUpdate.delivery_state, 'read');
});

test('registerMedia returns existing media hash as deduped', async () => {
  const supabase = new FakeSupabase();
  const controller = loadController(supabase);

  supabase.enqueue('chat_media_files', 'select', {
    data: { id: ids.message, file_hash: 'hash-1', cdn_url: 'https://cdn.example/existing.jpg' },
    error: null
  });

  const req = mockReq({ body: { fileHash: 'hash-1' } });
  const res = mockRes();

  await controller.registerMedia(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.wasDeduped, true);
  assert.equal(res.body.data.cdn_url, 'https://cdn.example/existing.jpg');
});

test('createCommunity creates umbrella chat, announcement channel, and memberships', async () => {
  const supabase = new FakeSupabase();
  const controller = loadController(supabase);

  supabase.enqueue('chats', 'insert', (call) => ({
    data: { id: ids.community, ...call.payload[0] },
    error: null
  }));
  supabase.enqueue('chats', 'insert', (call) => ({
    data: { id: ids.announcement, ...call.payload[0] },
    error: null
  }));
  supabase.enqueue('chat_participants', 'insert', { data: null, error: null });
  supabase.enqueue('chats', 'update', (call) => ({
    data: { id: ids.community, type: 'community', announcement_chat_id: ids.announcement, ...call.payload },
    error: null
  }));

  const req = mockReq({
    body: {
      name: 'Faculty of Engineering',
      participantIds: [ids.recipient],
      communityMemberVisibility: 'subgroups',
      communityJoinPolicy: 'admins'
    }
  });
  const res = mockRes();

  await controller.createCommunity(req, res);

  assert.equal(res.statusCode, 201);

  const chatInserts = supabase.findCalls('chats', 'insert');
  assert.equal(chatInserts[0].payload[0].type, 'community');
  assert.equal(chatInserts[1].payload[0].community_id, ids.community);
  assert.equal(chatInserts[1].payload[0].is_announcement_channel, true);
  assert.equal(chatInserts[1].payload[0].send_policy, 'admins');

  const participants = supabase.findCall('chat_participants', 'insert').payload;
  assert.equal(participants.length, 4);
  assert.ok(participants.some((row) => row.chat_id === ids.community && row.role === 'owner'));
  assert.ok(participants.some((row) => row.chat_id === ids.announcement && row.notification_level === 'urgent'));
});

test('createCommunityGroup enforces community admin and links subgroup to umbrella', async () => {
  const supabase = new FakeSupabase();
  const controller = loadController(supabase);

  supabase.enqueue('chats', 'select', {
    data: { id: ids.community, type: 'community', max_subgroups: 50 },
    error: null
  });
  supabase.enqueue('chat_participants', 'select', {
    data: { chat_id: ids.community, user_id: ids.sender, role: 'admin', status: 'active', is_approved: true },
    error: null
  });
  supabase.enqueue('chats', 'select', { count: 0, data: null, error: null });
  supabase.enqueue('chats', 'insert', (call) => ({
    data: { id: ids.chat, ...call.payload[0] },
    error: null
  }));
  supabase.enqueue('chat_participants', 'insert', { data: null, error: null });

  const req = mockReq({
    params: { communityId: ids.community },
    body: {
      name: 'CS301 Algorithms',
      type: 'course',
      participantIds: [ids.recipient],
      sendPolicy: 'all'
    }
  });
  const res = mockRes();

  await controller.createCommunityGroup(req, res);

  assert.equal(res.statusCode, 201);
  const groupInsert = supabase.findCall('chats', 'insert').payload[0];
  assert.equal(groupInsert.type, 'course');
  assert.equal(groupInsert.community_id, ids.community);
  assert.equal(groupInsert.is_announcement_channel, false);
});
