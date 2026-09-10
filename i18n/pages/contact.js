// /i18n/pages/contact.js — the long-form text of /contact.html, in every language but English.
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
    h1: "Contacto",
    introP1: "¿Encontró algo que no funciona, tiene una sugerencia o simplemente quiere saludar? Nos gustaría saber de usted.",
    ctaLink: "Juegue al Mahjong Solitario gratis →",
  },

  pt: {
    h1: "Contato",
    introP1: "Encontrou algo com problema, tem uma sugestão ou só quer dar um alô? A gente gosta de receber mensagens.",
    ctaLink: "Jogar Mahjong Paciência grátis →",
  },

  fr: {
    h1: "Nous contacter",
    introP1: "Vous avez trouvé un problème, une idée à nous proposer, ou simplement envie de dire bonjour ? Cela nous fera plaisir de vous lire.",
    ctaLink: "Jouer au Mahjong Solitaire gratuit →",
  },

  it: {
    h1: "Contatti",
    introP1: "Hai trovato qualcosa che non funziona, hai un suggerimento o vuoi solo salutare? Ci fa piacere ricevere un tuo messaggio.",
    ctaLink: "Gioca a Mahjong Solitario gratis →",
  },

  de: {
    h1: "Kontakt",
    introP1: "Haben Sie einen Fehler entdeckt, einen Vorschlag für uns, oder möchten Sie einfach Hallo sagen? Wir freuen uns über Ihre Nachricht.",
    ctaLink: "Mahjong Solitaire kostenlos spielen →",
  },

  ru: {
    h1: "Контакты",
    introP1: "Нашли ошибку, есть предложение или просто хочется поздороваться? Нам будет приятно получить от вас письмо.",
    ctaLink: "Играть в Маджонг-пасьянс бесплатно →",
  },

  tr: {
    h1: "İletişim",
    introP1: "Bir hata mı buldunuz, bir öneriniz mi var, yoksa sadece merhaba mı demek istiyorsunuz? Yazmanıza seviniriz.",
    ctaLink: "Ücretsiz Mahjong Solitaire oyna →",
  },

  id: {
    h1: "Kontak",
    introP1: "Menemukan yang tidak jalan, punya usulan, atau sekadar ingin menyapa? Kami senang mendengar kabar dari Anda.",
    ctaLink: "Main Mahjong Solitaire gratis →",
  },

  ko: {
    h1: "문의",
    introP1: "잘 안 되는 곳을 보셨거나, 이런 게 있으면 좋겠다는 생각이 드셨거나, 그냥 인사만 하고 싶으실 때도 편하게 알려 주세요. 반갑게 읽겠습니다.",
    ctaLink: "무료 마작 솔리테어 하기 →",
  },

  ja: {
    h1: "お問い合わせ",
    introP1: "うまく動かないところを見つけたとき、こうしてほしいというご希望があるとき、ただごあいさつだけでも、どうぞお知らせください。よろこんで拝見します。",
    ctaLink: "無料の麻雀ソリティアで遊ぶ →",
  },

  zh: {
    h1: "联系我们",
    introP1: "发现了哪里不对，有什么建议，或者只是想打个招呼，都欢迎告诉我们。我们很愿意听。",
    ctaLink: "玩免费麻将连连看 →",
  },

  "zh-Hant": {
    h1: "聯絡我們",
    introP1: "發現哪裡不對、有什麼建議，或者只是想打個招呼，都歡迎告訴我們。我們很樂意聽。",
    ctaLink: "玩免費麻將連連看 →",
  },

  ar: {
    h1: "اتصل بنا",
    introP1: "هل وجدت خطأً، أو لديك اقتراح، أو أردت أن تقول مرحبًا فقط؟ يسعدنا أن نسمع منك.",
    ctaLink: "العب ماهجونغ سوليتير مجانًا ←",
  },
};
