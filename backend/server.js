// server.js
const express  = require('express');
const http     = require('http');
const socketIo = require('socket.io');
const path     = require('path');

const app    = express();
const server = http.createServer(app);
const io     = socketIo(server);

// مسار المجلد الثابت (تأكد أن مسار memory-reorder-static صحيح)
const staticPath = path.join(__dirname, '../memory-reorder-static');
app.use(express.static(staticPath));

const PORT = 4001;

/**
 * دالة بسيطة لخلط (shuffle) مصفوفة عشوائيًا
 */
function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/**
 * التصنيفات مع روابط الصور
 */
const categoryImages = {
  fruits: [
    '/assets/fruits/1.jpg',
    '/assets/fruits/2.jpg',
    '/assets/fruits/3.jpg',
    '/assets/fruits/4.jpg',
    '/assets/fruits/5.jpg',
    '/assets/fruits/6.jpg'
  ],
  veggies: [
    '/assets/vegetables/1.jpg',
    '/assets/vegetables/2.jpg',
    '/assets/vegetables/3.jpg',
    '/assets/vegetables/4.jpg',
    '/assets/vegetables/5.jpg',
    '/assets/vegetables/6.jpg'
  ],
  animals: [
    '/assets/animals/1.jpg',
    '/assets/animals/2.jpg',
    '/assets/animals/3.jpg',
    '/assets/animals/4.jpg',
    '/assets/animals/5.jpg',
    '/assets/animals/6.jpg'
  ],
  tools: [
    '/assets/tools/1.jpg',
    '/assets/tools/2.jpg',
    '/assets/tools/3.jpg',
    '/assets/tools/4.jpg',
    '/assets/tools/5.jpg',
    '/assets/tools/6.jpg'
  ],
  drinks: [
    '/assets/drinks/1.jpg',
    '/assets/drinks/2.jpg',
    '/assets/drinks/3.jpg',
    '/assets/drinks/4.jpg',
    '/assets/drinks/5.jpg',
    '/assets/drinks/6.jpg'
  ]
};

// قائمة التصنيفات أبجديًا
const categories = Object.keys(categoryImages);

/**
 * هيكل بيانات كل غرفة
 * rooms[roomId] = {
 *   players: [ { id: socket.id, name: playerName }, ... ],
 *   categoryOrder: [ 'tools', 'animals', 'drinks', 'veggies', 'fruits' ],
 *   roundIndex: 0,
 *   scores: { 'Ali':0, 'Sara':1, ... },
 *   submissions: { 'Ali': { correct: 4 }, ... },
 *   items: [],   // الصور العشوائية المعروضة في الجولة
 *   answer: [],  // الترتيب الصحيح (عشوائي من items)
 *   gameStarted: false
 * }
 */
const rooms = {};

io.on('connection', socket => {
  console.log(`Socket connected: ${socket.id}`);

  /**
   * 1) حدث للتحقق من حالة الجولة قبل الانضمام
   *    العميل يرسل roomId، والخادم يرد بـ { inProgress: true/false }
   */
  socket.on('checkGameStatus', ({ roomId }) => {
    const room = rooms[roomId];
    if (room && room.gameStarted) {
      socket.emit('gameStatus', { inProgress: true });
    } else {
      socket.emit('gameStatus', { inProgress: false });
    }
  });

  /**
   * 2) حدث انضمام اللاعب إلى غرفة
   *    يتوقّع المعطيات: { roomId, playerName }
   */
  socket.on('joinRoom', ({ roomId, playerName }) => {
    // إنشاء الغرفة إن لم تكن موجودة
    if (!rooms[roomId]) {
      const randomOrder = shuffle(categories);
      rooms[roomId] = {
        players: [],
        categoryOrder: randomOrder,
        roundIndex: 0,
        scores: {},
        submissions: {},
        items: [],
        answer: [],
        gameStarted: false
      };
    }
    const room = rooms[roomId];

    // إذا الجولة بدأت بالفعل، نمنع الانضمام
    if (room.gameStarted) {
      socket.emit('errorJoin', {
        message: 'للأسف الجولة بدأت بالفعل؛ لا يمكنك الانضمام الآن.'
      });
      return;
    }

    // إضافة اللاعب إذا لم يكن موجودًا
    if (!room.players.some(p => p.id === socket.id)) {
      room.players.push({ id: socket.id, name: playerName });
      room.scores[playerName] = 0;
    }
    socket.join(roomId);

    // أرسل تحديث قائمة اللاعبين والنقاط للجميع
    io.in(roomId).emit('stateMulti', {
      players: room.players.map(p => ({ name: p.name })),
      scores: room.scores
    });
  });

  /**
   * 3) حدث بدء جولة جديدة
   *    يتوقّع المعطيات: { roomId }
   */
  socket.on('startRound', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // لا نبدأ الجولة إلّا إذا كان هناك لاعبان على الأقل
    if (room.players.length < 2) {
      socket.emit('errorMulti', {
        message: 'يجب أن يكون هناك لاعبان على الأقل لبدء الجولة.'
      });
      return;
    }

    // لا نبدأ إذا انتهت 5 جولات أو وصل أحدهم إلى 3 نقاط
    const someoneWinner = Object.values(room.scores).some(v => v === 3);
    if (room.roundIndex >= 5 || someoneWinner) {
      return;
    }

    // علَم بأن الجولة قد بدأت
    room.gameStarted = true;

    // اختر التصنيف الحالي
    const currentCategory = room.categoryOrder[room.roundIndex];
    const allItems        = categoryImages[currentCategory];
    const shuffledItems   = shuffle(allItems);
    const answerOrder     = shuffle(shuffledItems);

    // خزّن بيانات الجولة في الغرفة
    room.items       = shuffledItems;
    room.answer      = answerOrder;
    room.submissions = {}; // إعادة تهيئة التخمينات

    // أرسل للجميع: (items, answer, roundName, scores, currentRound, players)
    io.in(roomId).emit('roundStartedMulti', {
      items: shuffledItems,
      answer: answerOrder,             // ← الترتيب الصحيح يُرسل هنا
      roundName: currentCategory,
      scores: room.scores,
      currentRound: room.roundIndex + 1,
      players: room.players.map(p => ({ name: p.name }))
    });
  });

  /**
   * 4) استقبال تخمين (submitOrder) من لاعب
   *    يتوقّع المعطيات: { roomId, playerId, order }
   */
  socket.on('submitOrder', ({ roomId, playerId, order }) => {
    const room = rooms[roomId];
    if (!room) return;

    // حساب عدد الإجابات الصحيحة
    let correctCount = 0;
    for (let i = 0; i < room.answer.length; i++) {
      if (room.answer[i] === order[i]) {
        correctCount++;
      }
    }

    // سجلّ تخمين هذا اللاعب
    room.submissions[playerId] = { correct: correctCount };

    // أرسل تغذية راجعة للجميع
    io.in(roomId).emit('feedbackMulti', {
      player: playerId,
      correctCount,
      total: room.answer.length
    });

    // إن كان قد حقق الصف الكامل (6/6)، نعلنه فائز الجولة
    if (correctCount === room.answer.length) {
      room.scores[playerId] = (room.scores[playerId] || 0) + 1;

      io.in(roomId).emit('roundWinMulti', {
        scores: room.scores,
        winners: [playerId],
        roundNumber: room.roundIndex + 1,
        answer: room.answer
      });

      room.roundIndex++;

      // تحقق إن انتهت اللعبة (5 جولات أو وصول أحدهم إلى 3 نقاط)
      const someoneWinnerFinal = Object.values(room.scores).some(v => v === 3);
      if (room.roundIndex >= 5 || someoneWinnerFinal) {
        const maxPts = Math.max(...Object.values(room.scores));
        const finalWinners = Object.entries(room.scores)
          .filter(([name, pts]) => pts === maxPts)
          .map(([name]) => name);

        io.in(roomId).emit('finalGameEndMulti', {
          scores: room.scores,
          finalWinners
        });

        // بعد دقيقتين، احذف بيانات الغرفة لإعادة إنشائها لاحقًا
        setTimeout(() => {
          delete rooms[roomId];
        }, 2 * 60 * 1000);
      } else {
        // لم تنتهِ بعد: أعد تفعيل زرّ "بدء الجولة التالية"
        io.in(roomId).emit('enableStartNext');
      }

      return;
    }

    // إن لم يحصل على 6/6، نبقى ننتظر باقي اللاعبين
  });

  /**
   * 5) عند انقطاع اتصال (disconnect) أي عميل
   */
  socket.on('disconnect', () => {
    console.log(`Socket disconnected: ${socket.id}`);

    for (const roomId in rooms) {
      const room = rooms[roomId];
      const entry = room.players.find(p => p.id === socket.id);
      if (entry) {
        const playerName = entry.name;
        room.players = room.players.filter(p => p.id !== socket.id);
        delete room.scores[playerName];
        delete room.submissions[playerName];

        // أرسل تحديث قائمة اللاعبين والنقاط المتبقية
        io.in(roomId).emit('stateMulti', {
          players: room.players.map(p => ({ name: p.name })),
          scores: room.scores
        });
        break;
      }
    }
  });
});

server.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Serving static from: ${staticPath}`);
});
