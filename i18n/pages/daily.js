// /i18n/pages/daily.js — the long-form text of /daily.html (the Daily Challenge), in every language but English.
//
// English is NOT here, and must never be added: it lives in the page's own
// markup, under the data-i18n-content attributes, because that is the copy
// search engines read (a crawler sets no localStorage, so it always gets
// the default rendering). Adding an `en` block would be a second copy of
// every paragraph, free to drift from the one that ranks —
// tools/i18n-check.mjs fails the build if one appears.
//
// Shape: one block per language, keyed by the site's language code, holding
// the SAME keys the page uses. Values may carry our own inline markup —
// <strong>, <em>, a link — and are inserted as HTML, so keep the tags the
// English has, keep any href exactly as it is, and never paste markup from
// anywhere else into one.
//
//   export const content = {
//     ko: {
//       introH: "…",
//       introP1: "…",
//     },
//   };
//
// ALL OR NOTHING per language: a language listed here must carry every key
// this page uses, or `npm --prefix tools test` fails. That is deliberate —
// a page showing three Korean paragraphs and five English ones is worse
// than a page showing eight English ones. Leave your language out until it
// is complete.
//
// The exact key list for this page:  node tools/i18n-check.mjs --keys
// Tone, and what must not be translated:  /i18n/TRANSLATING.md
export const content = {
  es: {
    h1: "Desafío Diario de Mahjong",
    introH: "Un nuevo rompecabezas de Mahjong cada día",
    introP1: "El Desafío Diario es un solo tablero, creado a partir de la fecha de hoy: el mismo rompecabezas para todas las personas que juegan hoy. Siempre se puede terminar por completo, igual que cualquier tablero del juego principal, y cambia a medianoche según la hora de su país. Mañana le espera uno nuevo.",
    introP2: "Aquí están las mismas ayudas de siempre: deshacer sin límite, el botón de pista y la pantalla completa. Cuando termina el tablero, el día de hoy queda marcado en el calendario de arriba. No hay rachas que mantener ni nada que le apure: solo una marca tranquila.",
    ctaLink: "← ¿Prefiere un tablero sin límites y sin reloj? Juegue al juego principal",
  },

  pt: {
    h1: "Desafio Diário de Mahjong",
    introH: "Um novo quebra-cabeça de Mahjong por dia",
    introP1: "O Desafio Diário é um tabuleiro só, montado a partir da data de hoje — o mesmo quebra-cabeça para todo mundo que joga hoje. Ele sempre dá para terminar por completo, como todo tabuleiro do jogo principal, e troca à meia-noite no horário do seu fuso. Amanhã tem um novo esperando por você.",
    introP2: "Todas as ajudas de sempre estão aqui: desfazer sem limite, o botão de dica e a tela cheia. Quando você limpa o tabuleiro, o dia de hoje fica marcado no calendário acima. Sem contagem de dias seguidos, sem pressão: apenas uma marquinha tranquila de concluído.",
    ctaLink: "← Prefere um tabuleiro sem limite e sem relógio? Jogue o jogo principal",
  },

  fr: {
    h1: "Défi du Jour au Mahjong",
    introH: "Un nouveau Mahjong chaque jour",
    introP1: "Le Défi du Jour, c’est un seul plateau, créé à partir de la date du jour : le même casse-tête pour toutes les personnes qui jouent aujourd’hui. Il peut toujours être terminé entièrement — comme tous les plateaux du jeu principal — et il change à minuit, à l’heure de chez vous. Revenez demain, un nouveau vous attendra.",
    introP2: "Vous retrouvez ici tout ce qui aide : l’annulation sans limite, le bouton d’indice et le plein écran. Quand le plateau est vide, la journée est cochée dans le calendrier ci-dessus. Pas de série à tenir, aucune pression : juste une petite coche tranquille.",
    ctaLink: "← Vous préférez un plateau illimité et sans chronomètre ? Jouez au jeu principal",
  },

  it: {
    h1: "Sfida del Giorno di Mahjong",
    introH: "Un nuovo Mahjong ogni giorno",
    introP1: "La Sfida del Giorno è un tavolo solo, creato dalla data di oggi: lo stesso rompicapo per tutti quelli che giocano oggi. Si può sempre completare fino in fondo — come ogni tavolo del gioco principale — e cambia a mezzanotte, secondo l’ora del posto in cui sei. Domani te ne aspetta uno nuovo.",
    introP2: "Ci sono tutti gli aiuti di sempre: annullare senza limite, il pulsante dell’aiuto e lo schermo intero. Quando il tavolo è pulito, la giornata di oggi resta segnata nel calendario qui sopra. Nessuna serie da mantenere, nessuna fretta: solo un segno di spunta tranquillo.",
    ctaLink: "← Preferisci un tavolo senza limiti e senza orologio? Gioca al gioco principale",
  },

  de: {
    h1: "Mahjong-Tagesaufgabe",
    introH: "Jeden Tag ein neues Mahjong-Spiel",
    introP1: "Die Tagesaufgabe ist ein einzelnes Spielfeld, aus dem heutigen Datum gebildet — für alle, die heute spielen, dasselbe Rätsel. Es lässt sich immer vollständig auflösen, genau wie jedes Spielfeld im Hauptspiel, und um Mitternacht Ihrer Zeitzone beginnt ein neues. Kommen Sie morgen wieder, dann wartet das nächste.",
    introP2: "Alles Gewohnte finden Sie auch hier: beliebig oft zurücknehmen, den Tipp-Knopf und das Vollbild. Ist das Spielfeld leer, wird der heutige Tag im Kalender darüber abgehakt. Keine Serie, kein Druck — nur ein stilles Häkchen.",
    ctaLink: "← Lieber ein Spielfeld ohne Grenzen und ohne Uhr? Zum Hauptspiel",
  },

  ru: {
    h1: "Задача дня — маджонг-пасьянс",
    introH: "Каждый день новая раскладка маджонга",
    introP1: "Задача дня — это одна раскладка, составленная по сегодняшней дате: у всех, кто играет сегодня, она одинаковая. Её всегда можно разобрать до конца, как и любую раскладку в основной игре, а в полночь по вашему времени появляется новая. Заходите завтра — будет следующая.",
    introP2: "Здесь есть всё то же, что помогает в игре: отмена ходов без ограничений, кнопка подсказки и полный экран. Когда раскладка разобрана, сегодняшний день отмечается в календаре выше. Никаких серий и никакого давления — просто спокойная галочка.",
    ctaLink: "← Хочется раскладку без ограничений и без часов? Перейдите к основной игре",
  },

  tr: {
    h1: "Günün Mahjong Bulmacası",
    introH: "Her gün yeni bir Mahjong bulmacası",
    introP1: "Günün Bulmacası tek bir masadır: bugünün tarihinden hazırlanır ve bugün oynayan herkes için aynıdır. Ana oyundaki bütün masalar gibi her zaman sonuna kadar açılabilir ve kendi saat diliminizde gece yarısı yenilenir. Yarın yeni bir tanesi için yine uğrayın.",
    introP2: "Alışkın olduğunuz her şey burada da var: sınırsız geri alma, ipucu düğmesi ve tam ekran. Masayı temizlediğinizde bugün, yukarıdaki takvimde işaretlenir. Üst üste gün sayan bir çetele yok, baskı yok — yalnızca sessiz bir onay işareti.",
    ctaLink: "← Sınırsız ve saatsiz bir masa mı istersiniz? Ana oyunu oynayın",
  },

  id: {
    h1: "Tantangan Mahjong Harian",
    introH: "Papan Mahjong baru setiap hari",
    introP1: "Tantangan Harian adalah satu papan saja, dibuat dari tanggal hari ini — soal yang sama untuk semua orang yang bermain hari ini. Papan ini selalu bisa diselesaikan sampai habis, sama seperti setiap papan di permainan utama, dan berganti pada tengah malam menurut waktu di tempat Anda. Datang lagi besok, sudah ada yang baru.",
    introP2: "Semua yang biasa membantu ada di sini juga: pembatalan langkah tanpa batas, tombol petunjuk, dan layar penuh. Kalau papannya habis, hari ini ditandai selesai di kalender di atas. Tidak ada hitungan hari berturut-turut, tidak ada tuntutan — hanya satu centang yang tenang.",
    ctaLink: "← Lebih suka papan tanpa batas dan tanpa jam? Mainkan permainan utamanya",
  },

  ko: {
    h1: "오늘의 마작 도전",
    introH: "매일 새로운 마작 한 판",
    introP1: "오늘의 도전은 오늘 날짜로 만든 딱 한 판이에요. 오늘 하루는 누구나 같은 문제를 풀게 돼요. 이 판도 본 게임의 모든 판처럼 끝까지 다 풀 수 있게 만들어져 있고, 계신 곳의 자정이 지나면 새 판으로 바뀌어요. 내일 또 오시면 새로운 한 판이 기다리고 있어요.",
    introP2: "쓰시던 것은 여기에도 다 있어요. 횟수 제한 없는 되돌리기, 힌트 버튼, 전체 화면까지요. 판을 다 치우면 위쪽 달력에 오늘 날짜가 표시돼요. 며칠 연속으로 했는지 세지도 않고, 재촉하지도 않아요. 조용히 체크 표시 하나만 남습니다.",
    ctaLink: "← 판 수 제한도 시간 재기도 없는 쪽이 좋으세요? 본 게임 하러 가기",
  },

  ja: {
    h1: "麻雀 今日の一局",
    introH: "毎日ちがう麻雀の盤を一つ",
    introP1: "今日の一局は、今日の日付から作られた盤が一つだけです。今日遊ぶ方はみなさん同じ問題になります。本編のどの盤とも同じで、必ず最後まで消せるように作られていますし、お住まいの地域の夜の12時をまわると新しい盤に変わります。あすもまた、新しい一局をご用意しています。",
    introP2: "いつもの道具はこちらにもそろっています。回数の制限のない戻す、ヒントのボタン、それに全画面です。盤を消し終えると、上のカレンダーの今日のところに印がつきます。何日続いたかを数えたりはしませんし、急かすこともありません。静かなチェックの印が一つ残るだけです。",
    ctaLink: "← 制限も時間もない盤がよろしければ、本編へ",
  },

  zh: {
    h1: "麻将每日一局",
    introH: "每天一副新的麻将牌",
    introP1: "每日一局就是一副牌，按今天的日期生成 — 今天来玩的人，拿到的都是同一副。它跟主游戏里的每一副牌一样，一定能消完，并且会在您所在时区的午夜换成新的一副。明天再来，就有新的了。",
    introP2: "顺手的功能这里都在：不限次数的撤销、提示按钮，还有全屏。牌消完之后，上面的日历里今天就打上勾了。不数连续几天，也不催您，只是安安静静一个勾。",
    ctaLink: "← 想玩不限次数、也不计时的牌局？去玩主游戏",
  },

  "zh-Hant": {
    h1: "麻將每日一局",
    introH: "每天一副新的麻將牌",
    introP1: "每日一局就是一副牌，照今天的日期產生 — 今天來玩的人，拿到的都是同一副。它跟主遊戲裡的每一副牌一樣，一定消得完，而且會在您所在時區的午夜換成新的一副。明天再來，就有新的了。",
    introP2: "順手的功能這裡都有：沒有次數限制的復原、提示按鈕，還有全螢幕。牌消完之後，上面的日曆就會在今天打個勾。不數連續幾天，也不催您，只是安安靜靜一個勾。",
    ctaLink: "← 想玩沒有次數限制、也不計時的牌局？去玩主遊戲",
  },

  ar: {
    h1: "تحدي الماهجونغ اليومي",
    introH: "لغز ماهجونغ جديد كل يوم",
    introP1: "تحدي اليوم طاولة واحدة، تُعدّ من تاريخ اليوم، وهي اللغز نفسه لكل من يلعب اليوم. ويمكن إكمالها حتى النهاية دائمًا، مثل كل طاولة في اللعبة الأصلية، وتتجدد عند منتصف الليل بحسب توقيت بلدك. عُد غدًا لتجد لغزًا جديدًا.",
    introP2: "كل ما تعتاد عليه موجود هنا أيضًا: تراجع بلا حد، وزر التلميح، وملء الشاشة. وعندما تُنهي الطاولة، يُعلَّم يوم اليوم في التقويم أعلاه. لا عدّ لأيام متتابعة، ولا ضغط — مجرد علامة صح هادئة.",
    ctaLink: "→ تفضّل طاولة بلا حدود وبلا وقت؟ العب اللعبة الأصلية",
  },
};
