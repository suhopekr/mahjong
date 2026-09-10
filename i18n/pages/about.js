// /i18n/pages/about.js — the long-form text of /about.html, in every language but English.
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
    h1: "Acerca de Mahjong Solitario gratis",
    introH: "Hecho para fichas grandes y para jugar sin prisa",
    introP1: "Mahjong Solitario gratis nació de una molestia muy sencilla: la mayoría de los juegos de mahjong solitario que hay en internet meten 144 fichas diminutas en la pantalla, con dibujos pálidos y difíciles de leer, y encima le meten prisa con una cuenta atrás. Queríamos una versión que no hiciera ninguna de esas dos cosas.",
    introP2: "Así que aquí las fichas son grandes de entrada, con un estilo «Big &amp; Bold» (grande y claro) que cambia los dibujos tradicionales, tan cargados, por números grandes, iconos sencillos y colores bien diferenciados. Si prefiere el aspecto de siempre, puede volver al estilo Classic en Settings (los ajustes): los dos estilos se corresponden exactamente, así que cambiar de uno a otro nunca cambia cómo se juega la partida. No hay límite de tiempo, no hay cuenta atrás y no hay puntuación que perseguir. El relojito de la esquina está solo por si le interesa verlo, y también lo puede ocultar del todo.",
    introP3: "Cada tablero se genera con un algoritmo que comprueba que tenga solución, no se coloca al azar, así que nunca se va a encontrar con una disposición imposible de terminar. Y si a mitad de camino se queda sin parejas, las fichas que quedan se reordenan solas en una disposición nueva que sí se puede terminar. Deshacer no tiene límite, las pistas tampoco, y su partida se guarda sola en el navegador, así que puede seguir justo donde lo dejó. Sin descargas, sin cuenta, sin registro: solo abra la página y juegue.",
    ctaLink: "Juegue al Mahjong Solitario gratis →",
  },

  pt: {
    h1: "Sobre o Mahjong Paciência grátis",
    introH: "Feito para peças grandes e para jogar sem pressa",
    introP1: "O Mahjong Paciência grátis começou de um incômodo bem simples: a maioria dos jogos de mahjong paciência na internet enfia 144 peças minúsculas na tela, com desenhos apagados e difíceis de ler, e ainda por cima aperta você com uma contagem regressiva. A gente queria uma versão que não fizesse nenhuma dessas duas coisas.",
    introP2: "Por isso, aqui as peças já vêm grandes, com um estilo «Big &amp; Bold» (grande e claro) que troca os desenhos tradicionais, cheios de detalhes, por números grandes, ícones simples e cores fáceis de distinguir. Se você preferir o jeito de sempre, pode voltar ao estilo Classic em Settings (os ajustes): os dois estilos combinam exatamente um com o outro, então trocar nunca muda como a partida vai sair. Não tem limite de tempo, não tem contagem regressiva e não tem pontuação para perseguir. O reloginho no canto está ali só caso você queira ver — e dá para esconder por completo.",
    introP3: "Cada tabuleiro é montado por um algoritmo que confere se ele tem solução; não é jogado ao acaso. Assim você nunca cai num arranjo impossível de terminar — e, se travar no meio do caminho, as peças que sobraram se reorganizam sozinhas em um arranjo novo que dá para terminar. Desfazer é sem limite, as dicas são sem limite, e o seu jogo se salva sozinho no navegador, então você continua exatamente de onde parou. Sem download, sem conta, sem cadastro — basta abrir a página e jogar.",
    ctaLink: "Jogar Mahjong Paciência grátis →",
  },

  fr: {
    h1: "À propos du Mahjong Solitaire gratuit",
    introH: "Pensé pour de grandes tuiles et un jeu sans hâte",
    introP1: "Le Mahjong Solitaire gratuit est né d’un agacement tout simple : la plupart des mahjongs solitaires en ligne entassent 144 minuscules tuiles sur l’écran, avec des motifs pâles et difficiles à lire, et vous pressent en plus avec un compte à rebours. Nous voulions une version qui ne fasse ni l’un ni l’autre.",
    introP2: "Ici, les tuiles sont donc grandes dès le départ, avec un style « Big &amp; Bold » (grand et net) qui remplace les motifs traditionnels très chargés par de grands chiffres, des dessins simples et des couleurs bien distinctes. Si vous préférez l’aspect d’autrefois, vous pouvez revenir au style Classic dans Settings (les réglages) : les deux styles se correspondent exactement, si bien que changer ne modifie jamais le déroulement d’une partie. Il n’y a pas de limite de temps, pas de compte à rebours, et aucun score à courir après. La petite horloge dans le coin est là seulement si vous voulez la voir, et vous pouvez la masquer entièrement.",
    introP3: "Chaque plateau est créé par un algorithme qui vérifie qu’il a bien une solution, et non posé au hasard : vous ne tomberez donc jamais sur une disposition impossible à terminer — et si vous n’avez plus aucune paire en cours de partie, les tuiles restantes se replacent d’elles-mêmes dans une nouvelle disposition que l’on peut finir. L’annulation est illimitée, les indices sont illimités, et votre partie s’enregistre toute seule dans votre navigateur : vous reprenez exactement là où vous en étiez. Sans téléchargement, sans compte, sans inscription — ouvrez la page et jouez.",
    ctaLink: "Jouer au Mahjong Solitaire gratuit →",
  },

  it: {
    h1: "Chi siamo — il Mahjong Solitario gratis",
    introH: "Fatto per tessere grandi e per giocare con calma",
    introP1: "Il Mahjong Solitario gratis è nato da un fastidio molto semplice: la maggior parte dei mahjong solitari che si trovano online stipa 144 tessere minuscole sullo schermo, con disegni sbiaditi e difficili da leggere, e sopra a tutto ti mette fretta con un conto alla rovescia. Volevamo una versione che non facesse nessuna delle due cose.",
    introP2: "Così qui le tessere sono grandi già dall’inizio, con uno stile «Big &amp; Bold» (grande e chiaro) che sostituisce i disegni tradizionali, molto carichi, con numeri grandi, simboli semplici e colori ben distinti. Se preferisci l’aspetto di una volta, puoi tornare allo stile Classic in Settings (le impostazioni): i due stili si corrispondono esattamente, quindi passare da uno all’altro non cambia mai come va la partita. Non c’è limite di tempo, non c’è conto alla rovescia e non c’è nessun punteggio da rincorrere. L’orologino nell’angolo è lì soltanto se ti fa piacere vederlo, e puoi nasconderlo del tutto.",
    introP3: "Ogni tavolo è creato da un algoritmo che controlla che si possa risolvere, non messo giù a caso, così non ti trovi mai davanti a una disposizione impossibile da finire — e se a metà partita non resta nessuna coppia, le tessere rimaste si sistemano da sole in una nuova disposizione che si può completare. Annullare non ha limiti, gli aiuti non hanno limiti, e la partita si salva da sola nel browser, così riprendi esattamente da dove eri. Nessun download, nessun account, nessuna registrazione: apri la pagina e gioca.",
    ctaLink: "Gioca a Mahjong Solitario gratis →",
  },

  de: {
    h1: "Über dieses kostenlose Mahjong Solitaire",
    introH: "Gemacht für große Steine und ruhiges Spiel",
    introP1: "Dieses kostenlose Mahjong Solitaire ist aus einem einfachen Ärgernis entstanden: Die meisten Mahjong-Solitaire-Spiele im Internet drängen 144 winzige Steine auf den Bildschirm, mit blassen, schwer lesbaren Zeichen — und treiben Sie obendrein mit einem Countdown. Wir wollten eine Fassung, die beides nicht tut.",
    introP2: "Deshalb sind die Steine hier von Anfang an groß, im Stil „Big &amp; Bold“ (groß und deutlich), der die verschnörkelten traditionellen Muster durch große Zahlen, einfache Zeichen und klare Farben ersetzt. Wenn Sie das gewohnte Aussehen lieber mögen, können Sie unter Settings (Einstellungen) jederzeit auf den Stil Classic zurückwechseln: Die beiden Stile entsprechen sich genau, das Umschalten ändert also nie, wie eine Partie ausgeht. Es gibt kein Zeitlimit, keinen Countdown und keine Punktzahl, hinter der Sie her sein müssten. Die kleine Uhr in der Ecke ist nur da, falls Sie sie sehen möchten — und Sie können sie ganz ausblenden.",
    introP3: "Jedes Spielfeld wird von einem Verfahren gelegt, das prüft, ob es sich auflösen lässt; es wird nicht zufällig hingelegt. So geraten Sie nie an eine Anordnung, die nicht zu Ende gespielt werden kann — und wenn mitten im Spiel kein Paar mehr da ist, ordnen sich die übrigen Steine von selbst neu, wieder lösbar. Zurücknehmen geht beliebig oft, Tipps ebenso, und Ihr Spiel speichert sich von selbst in Ihrem Browser, sodass Sie genau dort weitermachen, wo Sie aufgehört haben. Kein Download, kein Konto, keine Anmeldung — Seite öffnen und spielen.",
    ctaLink: "Mahjong Solitaire kostenlos spielen →",
  },

  ru: {
    h1: "О бесплатном Маджонг-пасьянсе",
    introH: "Сделано для крупных костей и неспешной игры",
    introP1: "Бесплатный Маджонг-пасьянс начался с очень простого неудобства: почти все маджонг-пасьянсы в интернете умещают на экране 144 крошечные кости с бледными, плохо различимыми знаками, да ещё и подгоняют обратным отсчётом. Нам хотелось версию, в которой нет ни того, ни другого.",
    introP2: "Поэтому кости здесь сразу крупные, а стиль «Big &amp; Bold» (крупно и понятно) заменяет вычурные традиционные узоры большими цифрами, простыми значками и ясными цветами. Если привычный вид нравится больше, в Settings (настройках) можно вернуться к стилю Classic: два стиля точно соответствуют друг другу, так что переключение никогда не меняет ход партии. Ни ограничения по времени, ни обратного отсчёта, ни очков, за которыми надо гнаться, здесь нет. Маленькие часы в углу — только для тех, кому интересно на них смотреть, и их можно совсем убрать.",
    introP3: "Каждая раскладка создаётся по алгоритму, который проверяет, что её можно разобрать, а не выкладывается случайно, — поэтому вы никогда не попадёте на расклад без решения. А если в середине партии пары кончились, оставшиеся кости сами складываются в новую раскладку с решением. Отмена ходов не ограничена, подсказки тоже, и игра сохраняется в браузере сама, так что вы продолжите с того же места. Ничего не нужно скачивать, не нужен ни аккаунт, ни регистрация — просто откройте страницу и играйте.",
    ctaLink: "Играть в Маджонг-пасьянс бесплатно →",
  },

  tr: {
    h1: "Ücretsiz Mahjong Solitaire hakkında",
    introH: "Büyük taşlar ve aceleye gelmeyen bir oyun için",
    introP1: "Ücretsiz Mahjong Solitaire çok basit bir sıkıntıdan doğdu: internetteki mahjong solitaire oyunlarının çoğu 144 ufacık taşı ekrana sıkıştırıyor, desenleri de soluk ve okunması zor oluyor; üstüne bir de geri sayan bir saatle sizi acele ettiriyorlar. Biz bu iki şeyi yapmayan bir sürüm istedik.",
    introP2: "Bu yüzden buradaki taşlar baştan büyük. «Big &amp; Bold» (büyük ve net) biçimi, göz yoran geleneksel desenlerin yerine büyük sayılar, yalın simgeler ve birbirinden kolayca ayrılan renkler koyuyor. Eski görünümü daha çok seviyorsanız Settings (ayarlar) bölümünden Classic biçimine dönebilirsiniz: iki biçim birbiriyle tam olarak örtüşür, yani biçim değiştirmek oyunun gidişini hiç değiştirmez. Süre sınırı yok, geri sayım yok, peşinden koşacağınız bir puan da yok. Köşedeki küçük saat yalnızca görmek isteyenler için orada; dilerseniz tümüyle gizleyebilirsiniz.",
    introP3: "Her masa, çözülebildiği denetlenerek bir algoritmayla hazırlanır; taşlar rastgele serpilmez. Böylece bitirilemeyen bir dizilimle hiç karşılaşmazsınız — oyunun ortasında eşleşecek çift kalmazsa da geriye kalan taşlar kendiliğinden yeniden dizilir, yine bitirilebilecek biçimde. Geri alma sınırsız, ipuçları sınırsız; oyununuz tarayıcınıza kendiliğinden kaydedildiği için tam bıraktığınız yerden devam edersiniz. İndirme yok, hesap yok, kayıt yok — sayfayı açın ve oynayın.",
    ctaLink: "Ücretsiz Mahjong Solitaire oyna →",
  },

  id: {
    h1: "Tentang Mahjong Solitaire Gratis",
    introH: "Dibuat untuk batu besar dan permainan yang tidak buru-buru",
    introP1: "Mahjong Solitaire Gratis ini berawal dari satu hal sederhana yang mengganggu: sebagian besar permainan mahjong solitaire di internet menjejalkan 144 batu kecil-kecil ke layar, dengan gambar pudar yang susah dibaca, lalu masih juga memburu Anda dengan hitungan mundur. Kami ingin versi yang tidak melakukan dua hal itu.",
    introP2: "Karena itu batu di sini besar sejak awal, dengan gaya «Big &amp; Bold» (besar dan jelas) yang menggantikan pola tradisional yang ramai dengan angka besar, gambar sederhana, dan warna yang jelas berbeda. Kalau Anda lebih suka tampilan yang lama, Anda tetap bisa kembali ke gaya Classic di Settings (pengaturan): kedua gaya itu selalu sepadan satu lawan satu, jadi berganti gaya tidak pernah mengubah jalannya permainan. Tidak ada batas waktu, tidak ada hitungan mundur, dan tidak ada skor yang harus dikejar. Jam kecil di sudut hanya ada untuk Anda yang ingin melihatnya, dan bisa disembunyikan sama sekali.",
    introP3: "Setiap papan dibuat dengan perhitungan yang memastikan papan itu bisa diselesaikan, bukan ditaruh sembarangan, jadi Anda tidak akan pernah menemui susunan yang tidak mungkin dihabiskan — dan kalau di tengah jalan tidak ada lagi pasangan, batu yang tersisa menata dirinya sendiri menjadi susunan baru yang bisa diselesaikan. Pembatalan langkah tanpa batas, petunjuk tanpa batas, dan permainan Anda tersimpan sendiri di peramban, jadi Anda bisa melanjutkan tepat dari tempat Anda berhenti. Tanpa unduhan, tanpa akun, tanpa pendaftaran — cukup buka halamannya dan main.",
    ctaLink: "Main Mahjong Solitaire gratis →",
  },

  ko: {
    h1: "무료 마작 솔리테어 소개",
    introH: "큰 패로, 서두르지 않고 하시도록 만들었어요",
    introP1: "무료 마작 솔리테어는 아주 단순한 불편에서 시작했어요. 인터넷에 있는 마작 솔리테어는 대부분 작은 패 144개를 화면에 빽빽하게 채워 넣고, 무늬는 흐릿해서 알아보기 어려운데, 거기에 시간을 재는 카운트다운까지 붙여 재촉하지요. 그 두 가지를 하지 않는 게임을 만들고 싶었어요.",
    introP2: "그래서 여기서는 패가 처음부터 큽니다. 「Big &amp; Bold」(크고 뚜렷한) 패는 복잡한 전통 무늬 대신 큰 숫자와 단순한 그림, 그리고 뚜렷한 색으로 보여 줘요. 전통적인 모양이 좋으시면 Settings(설정)에서 Classic 패로 언제든 바꾸실 수 있어요. 두 가지는 서로 정확히 짝이 맞으니, 바꾸셔도 게임이 풀리는 방식은 달라지지 않아요. 시간 제한도, 카운트다운도, 좇아야 할 점수도 없어요. 구석의 작은 시계는 보고 싶으신 분을 위해 있는 것이고, 아예 감추실 수도 있어요.",
    introP3: "모든 판은 아무렇게나 늘어놓는 것이 아니라, 끝까지 풀 수 있는지 확인하는 방식으로 만들어져요. 그래서 끝낼 수 없는 판을 만나는 일은 없어요. 도중에 맞출 짝이 없어지면 남은 패가 저절로 다시 놓이는데, 그때도 끝까지 풀 수 있는 모양으로 놓여요. 되돌리기도 힌트도 횟수 제한이 없고, 하시던 게임은 브라우저에 저절로 저장되니 다음에 오시면 그 자리에서 이어서 하실 수 있어요. 내려받을 것도, 계정도, 회원가입도 없어요. 페이지를 열면 바로 하실 수 있습니다.",
    ctaLink: "무료 마작 솔리테어 하기 →",
  },

  ja: {
    h1: "無料の麻雀ソリティアについて",
    introH: "大きな牌で、急がずに遊べるように",
    introP1: "この無料の麻雀ソリティアは、ちょっとした不満から始まりました。ネットにある麻雀ソリティアはたいてい、小さな牌144枚を画面にびっしり詰め込み、絵柄も薄くて読み取りにくく、そのうえ残り時間のカウントダウンで急かしてきます。その二つをしないものが欲しかったのです。",
    introP2: "そこで、この牌は最初から大きくしてあります。「Big &amp; Bold」（大きくはっきり）の絵柄は、細かい伝統的な模様のかわりに、大きな数字と分かりやすい図、それに色分けを使っています。昔ながらの見た目がお好きなら、Settings（設定）でいつでも Classic の絵柄に戻せます。二つの絵柄はぴったり一対一で対応していますので、切り替えても勝負の流れは変わりません。制限時間もカウントダウンもなく、追いかける点数もありません。隅の小さな時計は、見たい方のために置いてあるだけで、まったく消しておくこともできます。",
    introP3: "盤面は、でたらめに並べるのではなく、最後まで消せるかどうかを確かめる仕組みで作っています。ですから、終われない配置に出会うことはありません。途中で組になる牌がなくなったときは、残りの牌が自分で、また最後まで消せる並びに直ります。戻すこともヒントも回数の制限がなく、遊んでいたゲームはブラウザに自動で保存されますので、次に開いたときは続きから遊べます。ダウンロードもアカウントも会員登録もいりません。ページを開けば、すぐに遊べます。",
    ctaLink: "無料の麻雀ソリティアで遊ぶ →",
  },

  zh: {
    h1: "关于免费麻将连连看",
    introH: "为大牌面和不着急的玩法而做",
    introP1: "免费麻将连连看是从一个很简单的烦恼开始的：网上大多数麻将连连看，把 144 张小小的牌挤在屏幕上，图案又淡又难认，还要用倒计时催着您。我们想做一个这两样都不做的版本。",
    introP2: "所以这里的牌一开始就是大的。「Big &amp; Bold」（大而清楚）这种牌面，把繁复的传统花样换成了大数字、简单的图形和分得很清楚的颜色。如果您更喜欢传统的样子，随时可以在 Settings（设置）里换回 Classic 牌面：两种牌面是一一对应的，所以换来换去都不会改变一局牌怎么走。这里没有时间限制，没有倒计时，也没有要追的分数。角落里那个小计时器只是给想看的人看的，不想看就整个藏起来。",
    introP3: "每一副牌都是用一套会检查「能不能消完」的算法摆出来的，不是随手一摆，所以您绝不会碰上一副消不完的牌。要是玩到中途没有对子可消了，剩下的牌会自己重新摆成一副还能消完的样子。撤销不限次数，提示也不限次数，玩到哪里都会自动存在您的浏览器里，下次来还是从那里接着玩。不用下载，不用账号，也不用注册 — 打开网页就能玩。",
    ctaLink: "玩免费麻将连连看 →",
  },

  "zh-Hant": {
    h1: "關於免費麻將連連看",
    introH: "為大牌面和不趕時間的玩法而做",
    introP1: "免費麻將連連看是從一個很簡單的煩惱開始的：網路上大多數的麻將連連看，把 144 張小小的牌擠在螢幕上，圖案又淡又難認，還用倒數計時催著您。我們想做一個這兩件事都不做的版本。",
    introP2: "所以這裡的牌一開始就是大的。「Big &amp; Bold」（大而清楚）這種牌面，把繁複的傳統花樣換成了大數字、簡單的圖形和分得很清楚的顏色。如果您比較喜歡傳統的樣子，隨時可以在 Settings（設定）裡換回 Classic 牌面：兩種牌面是一一對應的，所以換來換去都不會改變一局牌怎麼走。這裡沒有時間限制，沒有倒數計時，也沒有要追的分數。角落那個小計時器只是給想看的人看的，不想看就整個藏起來。",
    introP3: "每一副牌都是用一套會檢查「消不消得完」的演算法排出來的，不是隨手一擺，所以您絕對不會碰上一副消不完的牌。如果玩到一半沒有對子可消了，剩下的牌會自己重新排成一副還消得完的樣子。復原沒有次數限制，提示也沒有次數限制，玩到哪裡都會自動存在您的瀏覽器裡，下次來還是從那裡接著玩。不用下載，不用帳號，也不用註冊 — 打開網頁就能玩。",
    ctaLink: "玩免費麻將連連看 →",
  },

  ar: {
    h1: "عن ماهجونغ سوليتير المجانية",
    introH: "مصنوعة لأحجار كبيرة ولعب على مهل",
    introP1: "بدأت لعبة ماهجونغ سوليتير المجانية من مصدر إزعاج بسيط: معظم ألعاب ماهجونغ سوليتير على الإنترنت تحشر 144 حجرًا صغيرًا في الشاشة، برسوم باهتة يصعب تمييزها، ثم تستعجلك فوق ذلك بعدّ تنازلي. أردنا نسخة لا تفعل أيًّا من هذين الأمرين.",
    introP2: "لذلك الأحجار هنا كبيرة من البداية، ونمط «Big &amp; Bold» (كبير وواضح) يستبدل الزخارف التقليدية المزدحمة بأرقام كبيرة ورسوم بسيطة وألوان واضحة التمييز. وإن كنت تفضّل المظهر التقليدي، فيمكنك العودة إلى نمط Classic من Settings (الإعدادات): النمطان متقابلان تمامًا، فتغيير النمط لا يغيّر أبدًا سير اللعبة. لا وقت محدد، ولا عدّ تنازلي، ولا نقاط تسعى وراءها. والساعة الصغيرة في الزاوية موجودة لمن يحب أن يراها فقط، ويمكنك إخفاؤها تمامًا.",
    introP3: "كل طاولة تُعدّ بخوارزمية تتحقق من أنها قابلة للحل، وليست موزّعة عشوائيًا، فلن تصل أبدًا إلى ترتيب لا يمكن إكماله — وإن لم يبق أي زوج في منتصف اللعبة، ترتّب الأحجار الباقية نفسها من جديد في توزيع يمكن إكماله. التراجع بلا حد، والتلميحات بلا حد، ولعبتك تُحفظ في متصفحك تلقائيًا فتكمل من الموضع نفسه. لا تنزيل، ولا حساب، ولا تسجيل — افتح الصفحة والعب.",
    ctaLink: "العب ماهجونغ سوليتير مجانًا ←",
  },
};
