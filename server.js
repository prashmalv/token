// server.js
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
//const ThermalPrinter = require('node-thermal-printer').printer;
//const PrinterTypes = require('node-thermal-printer').types;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static('public'));
app.use(express.json());

// ─── MongoDB Setup ─────────────────────────────────────────────────────────────
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/queue_demo';
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

// Sequence counter for tokens
const CounterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 }
});
const Counter = mongoose.model('Counter', CounterSchema);

// Token model
const TokenSchema = new mongoose.Schema({
  tokenNumber: Number,
  status: {
    type: String,
    enum: ['pending','served','expired'],
    default: 'pending'
  },
  createdAt: { type: Date, default: Date.now },
  servedAt: Date,
  expiredAt: Date,
  counterId: String,
  // NEW FIELDS
  userName: String,
  mobile: String
});

const Token = mongoose.model('Token', TokenSchema);

// Helper to get next token number atomically
async function getNextTokenNumber() {
  const ret = await Counter.findOneAndUpdate(
    { _id: 'tokenSeq' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return ret.seq;
}

// ─── In-Memory Current Serving Map ────────────────────────────────────────────
const counters = { '1': null, '2': null, '3': null };

// On startup, reload latest served per counter
async function initCounters() {
  for (const id of Object.keys(counters)) {
    const t = await Token.findOne({ status:'served', counterId: id })
                         .sort({ servedAt: -1 })
                         .lean();
    counters[id] = t ? t.tokenNumber : null;
  }
}
initCounters();

// ─── Thermal Printer Setup (optional, uncomment to activate) ───────────────────
// const printer = new ThermalPrinter({
//   type: PrinterTypes.EPSON,
//   interface: 'usb',
//   options: { timeout: 5000 }
// });

// ─── API: Issue & Print Token ──────────────────────────────────────────────────
// ─── API: Issue & Print Token with Name + Mobile ───────────────────────────────
app.post('/api/token', async (req, res) => {
  const { name, mobile } = req.body;

  if (!name || !mobile || !/^\d{10}$/.test(mobile)) {
    return res.status(400).json({ error: 'Invalid name or mobile number' });
  }

  const tokenNum = await getNextTokenNumber();

  await Token.create({
    tokenNumber: tokenNum,
    status: 'pending',
    createdAt: new Date(),
    counterId: null,
    // new fields
    userName: name,
    mobile: mobile
  });

  // Optional: Print logic (enable later)
  // try {
  //   await printer.printText(`*** TOKEN ${tokenNum} ***\nName: ${name}\nMobile: ${mobile}`);
  //   await printer.cut();
  // } catch (err) {
  //   console.error('Print error:', err);
  // }

  io.emit('update', { counters, latest: tokenNum });
  res.json({ token: tokenNum });
});

// ─── API: Get Pending Tokens for Display ─────────────────────────────────────
app.get('/api/pending', async (req, res) => {
  const pending = await Token.find({ status: 'pending' }).sort({ createdAt: 1 });
  res.json(pending);
});


// ─── API: Counter Serves a Token ───────────────────────────────────────────────
app.post('/api/serve', async (req, res) => {
  const { counterId, token } = req.body;
  await Token.findOneAndUpdate(
    { tokenNumber: token },
    { status: 'served', servedAt: new Date(), counterId }
  );
  counters[counterId] = token;
  io.emit('update', { counters, latest: null });
  res.json({ ok: true });
});

// ─── Auto-Expire Job (every minute) ────────────────────────────────────────────
setInterval(async () => {
  const cutoff = new Date(Date.now() - 2*60*60*1000); // 2 hrs ago
  const expired = await Token.updateMany(
    { status: 'pending', createdAt: { $lt: cutoff } },
    { status: 'expired', expiredAt: new Date() }
  );
  if (expired.nModified) {
    console.log(`Expired ${expired.nModified} tokens.`);
    io.emit('expire');
  }
}, 60*1000);

// ─── Socket.IO Connection ────────────────────────────────────────────────────
io.on('connection', socket => {
  socket.emit('update', { counters, latest: null });
});

// ─── Start Server ─────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
