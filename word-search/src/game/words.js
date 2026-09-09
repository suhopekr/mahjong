// game/words.js
// The themed word lists. Plain data, no logic: every word is uppercase
// A–Z, 4–10 letters, no spaces or hyphens, and each theme carries 20–30
// words so a puzzle can always pick its 6, 8 or 10 without repeating a
// word that hides inside another (the generator refuses such pairs —
// ROSE inside PRIMROSE would otherwise be found twice).
//
// `id` is the i18n key of the theme's name (src/i18n/strings.js has
// themeGarden: "Garden" and so on — the translator adds the other
// languages); `name` is the English, kept here for tests and analytics.
// The words themselves are English in v1 — see NOTES.md.
//
// Themes rotate one per day for "Today's puzzle" (see dailyThemeIndex in
// wordsearch.js), so the order here is the order players meet them.

export const THEMES = [
  { id: "themeGarden", name: "Garden", words: [
    "ROSE", "TULIP", "DAISY", "LILY", "FERN", "MOSS", "SEED", "SOIL", "SPADE", "RAKE",
    "HOSE", "LAWN", "HEDGE", "SHRUB", "PETAL", "BLOOM", "VINE", "WEED", "TROWEL", "BASKET",
    "PANSY", "BULB", "LEAF", "POND", "BENCH", "TRELLIS", "COMPOST", "ORCHARD", "BLOSSOM", "SUNDIAL",
  ] },
  { id: "themeKitchen", name: "Kitchen", words: [
    "SPOON", "FORK", "KNIFE", "PLATE", "BOWL", "KETTLE", "OVEN", "STOVE", "LADLE", "WHISK",
    "APRON", "TOWEL", "SINK", "TRAY", "GRATER", "TIMER", "SPICE", "PANTRY", "TEAPOT", "SAUCER",
    "SKILLET", "BLENDER", "TOASTER", "CUPBOARD", "COLANDER", "MIXER", "DISH", "PEELER", "SIEVE", "JUICER",
  ] },
  { id: "themeBirds", name: "Birds", words: [
    "ROBIN", "WREN", "FINCH", "SPARROW", "CROW", "DOVE", "HERON", "SWAN", "GOOSE", "DUCK",
    "EAGLE", "HAWK", "GULL", "LARK", "THRUSH", "MAGPIE", "PIGEON", "PARROT", "PELICAN", "PUFFIN",
    "KINGFISHER", "STARLING", "SWALLOW", "BLUEBIRD", "CARDINAL", "RAVEN", "STORK", "CRANE", "QUAIL", "OSPREY",
  ] },
  { id: "themeFlowers", name: "Flowers", words: [
    "ROSE", "TULIP", "DAISY", "LILY", "IRIS", "POPPY", "PANSY", "PEONY", "ORCHID", "LILAC",
    "VIOLET", "JASMINE", "DAHLIA", "LOTUS", "ASTER", "CROCUS", "AZALEA", "BEGONIA", "FREESIA", "GARDENIA",
    "MAGNOLIA", "LAVENDER", "MARIGOLD", "PRIMROSE", "SUNFLOWER", "BLUEBELL", "CAMELLIA", "HYACINTH", "SNOWDROP", "FOXGLOVE",
  ] },
  { id: "themeTravel", name: "Travel", words: [
    "TICKET", "TRAIN", "PLANE", "HOTEL", "BEACH", "CRUISE", "FERRY", "TAXI", "ROAD", "JOURNEY",
    "LUGGAGE", "CAMERA", "GUIDE", "TOUR", "VISA", "FLIGHT", "AIRPORT", "STATION", "HARBOUR", "ISLAND",
    "VOYAGE", "COACH", "CABIN", "RESORT", "POSTCARD", "SOUVENIR", "BACKPACK", "COMPASS", "PICNIC", "ADVENTURE",
  ] },
  { id: "themeMusic", name: "Music", words: [
    "PIANO", "VIOLIN", "GUITAR", "DRUM", "FLUTE", "HARP", "CELLO", "TRUMPET", "BANJO", "ORGAN",
    "SONG", "TUNE", "NOTE", "CHORD", "MELODY", "RHYTHM", "TEMPO", "CHOIR", "BAND", "SINGER",
    "OPERA", "BALLAD", "WALTZ", "CONCERT", "CLARINET", "TROMBONE", "LULLABY", "HYMN", "ANTHEM", "ENCORE",
  ] },
  { id: "themeSewingCrafts", name: "Sewing & Crafts", words: [
    "NEEDLE", "THREAD", "BUTTON", "ZIPPER", "FABRIC", "PATTERN", "THIMBLE", "SCISSORS", "BOBBIN", "STITCH",
    "SEAM", "QUILT", "YARN", "WOOL", "KNIT", "CROCHET", "EMBROIDERY", "LACE", "RIBBON", "VELVET",
    "LINEN", "COTTON", "SILK", "DENIM", "PATCH", "PLEAT", "TASSEL", "BEADS", "CANVAS", "TAPESTRY",
  ] },
  { id: "themeWeather", name: "Weather", words: [
    "RAIN", "SNOW", "WIND", "STORM", "CLOUD", "SUNNY", "FROST", "HAIL", "SLEET", "MIST",
    "BREEZE", "GALE", "THUNDER", "LIGHTNING", "RAINBOW", "DRIZZLE", "SHOWER", "FLOOD", "DROUGHT", "HUMID",
    "CHILLY", "BLIZZARD", "TORNADO", "HURRICANE", "CYCLONE", "ICICLE", "SUNSHINE", "OVERCAST", "FORECAST", "MONSOON",
  ] },
  { id: "themeFamily", name: "Family", words: [
    "MOTHER", "FATHER", "SISTER", "BROTHER", "GRANDMA", "GRANDPA", "AUNT", "UNCLE", "COUSIN", "NIECE",
    "NEPHEW", "DAUGHTER", "BABY", "TWINS", "WIFE", "HUSBAND", "PARENT", "CHILD", "HOME", "LOVE",
    "WEDDING", "BIRTHDAY", "REUNION", "STORY", "DINNER", "MEMORY", "ALBUM", "PHOTO", "GRANDSON", "LAUGHTER",
  ] },
  { id: "themeBaking", name: "Baking", words: [
    "FLOUR", "SUGAR", "BUTTER", "EGGS", "YEAST", "DOUGH", "OVEN", "CAKE", "BREAD", "SCONE",
    "PASTRY", "MUFFIN", "COOKIE", "BISCUIT", "TART", "CRUST", "ICING", "VANILLA", "CINNAMON", "GINGER",
    "RAISIN", "ALMOND", "WALNUT", "HONEY", "CREAM", "BATTER", "SPONGE", "LOAF", "BAGEL", "BROWNIE",
  ] },
  { id: "themeOcean", name: "Ocean", words: [
    "WAVE", "TIDE", "SHELL", "SAND", "CORAL", "WHALE", "SHARK", "DOLPHIN", "SEAL", "CRAB",
    "OYSTER", "PEARL", "OCTOPUS", "SQUID", "JELLYFISH", "STARFISH", "TURTLE", "SEAWEED", "ANCHOR", "BOAT",
    "SHIP", "SAILOR", "LIGHTHOUSE", "SEAGULL", "SURF", "REEF", "LAGOON", "BEACH", "MERMAID", "LOBSTER",
  ] },
  { id: "themeColours", name: "Colours", words: [
    "BLUE", "GREEN", "YELLOW", "ORANGE", "PURPLE", "PINK", "BROWN", "BLACK", "WHITE", "GREY",
    "GOLD", "SILVER", "IVORY", "CREAM", "NAVY", "TEAL", "CORAL", "PEACH", "LILAC", "VIOLET",
    "INDIGO", "SCARLET", "CRIMSON", "MAROON", "AMBER", "BEIGE", "OLIVE", "MUSTARD", "LAVENDER", "EMERALD",
  ] },
  { id: "themeFruit", name: "Fruit", words: [
    "APPLE", "PEAR", "PLUM", "PEACH", "GRAPE", "LEMON", "LIME", "ORANGE", "BANANA", "CHERRY",
    "MANGO", "MELON", "KIWI", "DATE", "OLIVE", "PAPAYA", "GUAVA", "LYCHEE", "APRICOT", "AVOCADO",
    "COCONUT", "CURRANT", "RHUBARB", "QUINCE", "NECTARINE", "TANGERINE", "PINEAPPLE", "STRAWBERRY", "BLUEBERRY", "RASPBERRY",
  ] },
  { id: "themeHolidays", name: "Holidays", words: [
    "GIFT", "CARD", "PARTY", "CAKE", "CANDLE", "FEAST", "TURKEY", "TINSEL", "WREATH", "HOLLY",
    "SLEIGH", "CAROL", "STOCKING", "RIBBON", "SNOWMAN", "EASTER", "BUNNY", "PUMPKIN", "LANTERN", "FIREWORK",
    "PARADE", "PICNIC", "PRESENT", "GARLAND", "MISTLETOE", "PUDDING", "CRACKER", "ORNAMENT", "CHIMNEY", "REINDEER",
  ] },
  { id: "themeFarm", name: "Farm", words: [
    "BARN", "HORSE", "SHEEP", "GOAT", "CHICKEN", "DUCK", "TRACTOR", "WHEAT", "CORN", "FIELD",
    "FENCE", "PLOUGH", "HARVEST", "ORCHARD", "MEADOW", "STABLE", "DAIRY", "MILK", "EGGS", "WOOL",
    "LAMB", "CALF", "FOAL", "PONY", "DONKEY", "ROOSTER", "SCARECROW", "SILO", "BARLEY", "PASTURE",
  ] },
  { id: "themeTeaTime", name: "Tea Time", words: [
    "TEAPOT", "TEACUP", "SAUCER", "SPOON", "SUGAR", "MILK", "HONEY", "LEMON", "SCONE", "BISCUIT",
    "CAKE", "CREAM", "TOAST", "BUTTER", "KETTLE", "STEAM", "BREW", "STEEP", "COSY", "TRAY",
    "DOILY", "NAPKIN", "SANDWICH", "PASTRY", "TART", "CHATTER", "FRIEND", "AFTERNOON", "CHINA", "CHAMOMILE",
  ] },
];
