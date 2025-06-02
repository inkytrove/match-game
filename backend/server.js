const express   = require('express');
const http      = require('http');
const socketIo  = require('socket.io');
const path      = require('path');

const app    = express();
const server = http.createServer(app);
const io     = socketIo(server);

const staticPath = path.join(__dirname, '../memory-reorder-static');
app.use(express.static(staticPath));

const PORT = 4001;

// دالة لمزج المصفوفة عشوائيًا
function shuffle(array) {
  const arr = array.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// التصنيفات مع روابط الصور
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

// كائن لتخزين بيانات كل غرفة
// هيكل بيانات الغرفة:
// rooms[roomId] = {
//   players: [ { id: socket.id, name: playerName }, ... ],
//   categoryOrder: [ 'tools', 'animals', 'drinks', 'veggies', 'fruits' ],
//   roundIndex: 0,
//   scores: { 'Ali':0, 'Sara':1, ... },
//   submissions: { 'Ali': { correct: 4 }, ... },
//   items: [],   // الصور العشوائية المعروضة في الجولة
//   answer: []   // الترتيب الصحيح (عشوائي من items)
// }
const rooms = {};

io.on('connection', socket => {

  // انضمام لاعب إلى غرفة
  socket.on('joinRoom', ({ roomId, playerName }) => {
    socket.join(roomId);

    // إذا الغرفة غير موجودة، ننشئها
    if (!rooms[roomId]) {
      const randomOrder = shuffle(categories);
      rooms[roomId] = {
        players: [],
        categoryOrder: randomOrder,
        roundIndex: 0,
        scores: {},
        submissions: {},
        items: [],
        answer: []
      };
    }
    const room = rooms[roomId];

    // أضف اللاعب إذا لم يكن مضافًا بعد
    if (!room.players.some(p => p.id === socket.id)) {
      room.players.push({ id: socket.id, name: playerName });
      room.scores[playerName] = 0;
    }

    // أرسل قائمة اللاعبين المحدثة ونقاطهم
    io.in(roomId).emit('stateMulti', {
      players: room.players.map(p => ({ name: p.name })),
      scores: room.scores
    });
  });

  // بدء جولة جديدة
  socket.on('startRound', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    // لا نبدأ الجولة إلا إذا كان هناك لاعبان على الأقل
    if (room.players.length < 2) {
      socket.emit('errorMulti', {
        message: 'يجب أن يكون هناك لاعبان على الأقل لبدء الجولة.'
      });
      return;
    }

    // لا تبدأ إذا انتهت 5 جولات أو وصل أحدهم إلى 3 نقاط
    const someoneWinner = Object.values(room.scores).some(v => v === 3);
    if (room.roundIndex >= 5 || someoneWinner) {
      return;
    }

    // اختر التصنيف التالي من التسلسل العشوائي المحفوظ
    const currentCategory = room.categoryOrder[room.roundIndex];
    const allItems        = categoryImages[currentCategory];
    const shuffledItems   = shuffle(allItems);
    const answerOrder     = shuffle(shuffledItems);

    // احفظ بيانات الجولة في الغرفة
    room.items       = shuffledItems;
    room.answer      = answerOrder;
    room.submissions = {}; // نعيد تهيئة التخمينات

    // أرسل إلى الجميع حدث بدء الجولة
    io.in(roomId).emit('roundStartedMulti', {
      items: shuffledItems,
      roundName: currentCategory,
      scores: room.scores,
      currentRound: room.roundIndex + 1,
      players: room.players.map(p => ({ name: p.name }))
    });
  });

  // استقبال تخمين من لاعب
  socket.on('submitOrder', ({ roomId, playerId, order }) => {
    const room = rooms[roomId];
    if (!room) return;

    // نحسب عدد الإجابات الصحيحة لهذا التخمين
    let correctCount = 0;
    for (let i = 0; i < room.answer.length; i++) {
      if (room.answer[i] === order[i]) {
        correctCount++;
      }
    }

    // سجِّل أو حدِّث تخمين هذا اللاعب في الغرفة
    room.submissions[playerId] = { correct: correctCount };

    // أرسل تغذية راجعة جزئية لكل اللاعبين (من ضمنهم هذا اللاعب)
    io.in(roomId).emit('feedbackMulti', {
      player: playerId,
      correctCount,
      total: room.answer.length
    });

    // إذا اللاعب حقق 6/6 (كل الإجابات صحيحة)، نعلنه فائز الجولة فورًا
    if (correctCount === room.answer.length) {
      // نمنحه نقطةً واحدةً
      room.scores[playerId] = (room.scores[playerId] || 0) + 1;

      // أرسل حدث فوز الجولة لكل اللاعبين
      io.in(roomId).emit('roundWinMulti', {
        scores: room.scores,
        winners: [playerId],              // فقط اللاعب الذي حقق 6/6
        roundNumber: room.roundIndex + 1,
        answer: room.answer
      });

      // زد عداد الجولة
      room.roundIndex++;

      // تحقق إن انتهت اللعبة (5 جولات أو شخص وصل 3 نقاط)
      const someoneWinnerFinal = Object.values(room.scores).some(v => v === 3);
      if (room.roundIndex >= 5 || someoneWinnerFinal) {
        // حدد الفائزين النهائيين (أعلى نقطة)
        const maxPts = Math.max(...Object.values(room.scores));
        const finalWinners = Object.entries(room.scores)
          .filter(([name, pts]) => pts === maxPts)
          .map(([name, _]) => name);

        io.in(roomId).emit('finalGameEndMulti', {
          scores: room.scores,
          finalWinners
        });

        // بعد دقيقتين احذف بيانات الغرفة لتمكين إعادة إنشاءها
        setTimeout(() => {
          delete rooms[roomId];
        }, 2 * 60 * 1000);

      } else {
        // إن لم تنتهِ اللعبة بعد، أعِد تفعيل زر “بدء الجولة” للجولة التالية
        io.in(roomId).emit('enableStartNext');
      }

      return;
    }

    // إذا لم يحصُل على 6/6 بعد، ننتظر بقية اللاعبين (أو حتى يعيد هو المحاولة)
    // لا نُعلن فائزًا قبل إكمال التخمين الصحيح.
  });

});

server.listen(PORT, () => {
  console.log(`Server running on http://0.0.0.0:${PORT}`);
  console.log(`Serving static from: ${staticPath}`);
});
