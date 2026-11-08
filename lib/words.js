// Secret phrases, each with a one-word synonym the Agent gets as a hint.
// The Citizens see the whole phrase; the Agent sees blanks (Wheel of Fortune
// style), starting with the first letter of every word, and gets one more letter
// each round. Phrases: letters, numbers and spaces only, at least 16 letters
// (spaces don't count). Hints should be one word that isn't in the phrase.
// Entries that break these rules are filtered out below, so they never get dealt.
const MIN_LETTERS = 16;

const PHRASES = {
  // Sayings and idioms
  "Light at the end of the tunnel": "Hope",
  "Butterflies in your stomach": "Nerves",
  "Needle in a haystack": "Impossible",
  "Building castles in the air": "Daydream",
  "Elephant in the room": "Taboo",
  "Calm before the storm": "Lull",
  "Writing on the wall": "Omen",
  "Happens once in a blue moon": "Rarely",
  "Barking up the wrong tree": "Mistaken",
  "Burning the midnight oil": "Overtime",
  "Every cloud has a silver lining": "Optimism",
  "Actions speak louder than words": "Deeds",
  "The ball is in your court": "Turn",
  "Bite off more than you can chew": "Overcommit",
  "A blessing in disguise": "Serendipity",
  "Cutting corners to save time": "Shortcut",
  "Let sleeping dogs lie": "Avoid",
  "Making a mountain out of a molehill": "Overreact",
  "Missing the forest for the trees": "Nitpicking",
  "Out of the frying pan into the fire": "Worse",
  "Spill the beans at dinner": "Confess",
  "Throwing caution to the wind": "Reckless",
  "Water under the bridge": "Forgiven",
  "When pigs fly over the barn": "Never",
  "A tempest in a teapot": "Fuss",
  "Back to the drawing board": "Restart",
  "Between a rock and a hard place": "Dilemma",
  "Hitting the nail on the head": "Exactly",
  "Jumping on the bandwagon": "Trend",
  "Keeping your cards close to your chest": "Secretive",
  "Lost in the shuffle": "Overlooked",
  "Pulling the rug out from under": "Betrayal",
  "Reading between the lines": "Subtext",
  "Running out of steam": "Exhausted",
  "Swimming against the current": "Rebel",
  "The tip of the iceberg": "Glimpse",
  "Walking on eggshells": "Careful",
  "Wearing your heart on your sleeve": "Open",
  "Whistling in the dark": "Bravado",
  "Like a fish out of water": "Misfit",

  // Moments and scenes
  "Last call at the corner bar": "Closing",
  "Cold feet at the altar": "Jitters",
  "Spare key under the welcome mat": "Backup",
  "Rush hour traffic on a Friday": "Gridlock",
  "Slow motion instant replay": "Rewind",
  "Golden hour on the rooftop": "Sunset",
  "Campfire ghost stories": "Folklore",
  "Message in a bottle at sea": "Castaway",
  "Fortune cookie wisdom": "Prophecy",
  "Thunderstorm warning in effect": "Alert",
  "Spring cleaning the attic": "Declutter",
  "Lazy Sunday morning in bed": "Leisure",
  "Haunted hallway at midnight": "Spooky",
  "Treehouse rules no grownups": "Clubhouse",
  "Northern lights over the lake": "Aurora",
  "Secret family recipe": "Heirloom",
  "Buried treasure on a desert island": "Loot",
  "Finishing touches on the masterpiece": "Polish",
  "Home field advantage in the playoffs": "Edge",
  "Behind the scenes of the show": "Backstage",
  "Off the record conversation": "Confidential",
  "First impressions at an interview": "Introduction",
  "Wishful thinking on a birthday": "Fantasy",
  "Uncharted waters ahead": "Unknown",
  "Moving the goalposts again": "Unfair",
  "Second chances at the reunion": "Redemption",
  "Growing pains in middle school": "Adolescence",
  "Mixed signals over text": "Confusion",
  "Borrowed time on the clock": "Reprieve",
  "Bright side of the situation": "Positivity",
  "Full circle moment at graduation": "Closure",
  "Shooting star over the desert": "Meteor",
};

const letterCount = (p) => (p.match(/[a-z0-9]/gi) || []).length;
const words = (p) => p.toLowerCase().split(/\s+/);
const valid = ([phrase, hint]) =>
  letterCount(phrase) >= MIN_LETTERS && /^[a-z]+$/i.test(hint) && !words(phrase).includes(hint.toLowerCase());

const VALID = Object.entries(PHRASES).filter(valid);
module.exports = VALID.map(([phrase]) => phrase);
module.exports.hints = Object.fromEntries(VALID);
module.exports.MIN_LETTERS = MIN_LETTERS;
