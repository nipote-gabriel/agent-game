// Secret phrases, each with a one-word synonym the Agent gets as a hint.
// The Citizens see the whole phrase; the Agent sees blanks (Wheel of Fortune
// style), starting with the first letter of every word, and gets one more letter
// each round. Phrases: letters, numbers and spaces only, at least 12 letters
// (spaces don't count). Hints should be one word that isn't in the phrase.
// Entries that break these rules are filtered out below, so they never get dealt.
const MIN_LETTERS = 12;

const PHRASES = {
  "Home field advantage": "Edge",
  "Quiet confidence": "Poise",
  "Breaking point": "Limit",
  "Common ground": "Agreement",
  "Lost and found": "Recovery",
  "Behind the scenes": "Backstage",
  "Off the record": "Confidential",
  "Under construction": "Unfinished",
  "Uncharted waters": "Unknown",
  "Wishful thinking": "Fantasy",
  "First impression": "Introduction",
  "Guilty pleasure": "Indulgence",
  "Muscle memory": "Habit",
  "Happy accident": "Serendipity",
  "Silver lining": "Upside",
  "Distant thunder": "Rumble",
  "Midnight snack": "Nibble",
  "Morning ritual": "Routine",
  "Branching paths": "Choices",
  "Turning leaves": "Autumn",
  "Glass ceiling": "Barrier",
  "Moving target": "Elusive",
  "Rising tide at dawn": "Daybreak",
  "Second chances": "Redemption",
  "Growing pains": "Adolescence",
  "Mixed signals": "Confusion",
  "Hidden talents": "Gifts",
  "Borrowed time": "Reprieve",
  "Golden hour light": "Sunset",
  "After the storm": "Aftermath",
  "Long weekend away": "Vacation",
  "Last call at the bar": "Closing",
  "Uphill battle": "Struggle",
  "Slow motion replay": "Rewind",
  "Open road ahead": "Journey",
  "Cold feet at the altar": "Jitters",
  "Root of the problem": "Cause",
  "Front row seat": "Spectator",
  "Road trip snacks": "Provisions",
  "Spare key under the mat": "Backup",
  "Bright side of life": "Optimism",
  "Wild card entry": "Underdog",
  "Old habits die hard": "Stubborn",
  "Full circle moment": "Closure",
  "Under pressure": "Stressed",
  "Rush hour traffic": "Gridlock",
  "Shooting star": "Meteor",
  "Castles in the air": "Daydream",
  "Butterflies in your stomach": "Nerves",
  "Elephant in the room": "Taboo",
  "Needle in a haystack": "Impossible",
  "Light at the end of the tunnel": "Hope",
  "Calm before the storm": "Lull",
  "Tip of the iceberg": "Glimpse",
  "Writing on the wall": "Omen",
  "Message in a bottle": "Castaway",
  "Ghost of a chance": "Longshot",
  "Change of heart": "Reversal",
  "Stroke of luck": "Fluke",
  "Fish out of water": "Misfit",
  "Under the weather": "Sick",
  "Once in a blue moon": "Rarely",
  "Northern lights": "Aurora",
  "Secret ingredient": "Recipe",
  "Hidden treasure": "Loot",
  "Starting line": "Beginning",
  "Finishing touches": "Polish",
  "Spring cleaning": "Declutter",
  "Sunday morning": "Leisure",
  "Thunderstorm warning": "Alert",
  "Campfire stories": "Folklore",
  "Haunted hallway": "Spooky",
  "Treehouse rules": "Clubhouse",
  "Weekend getaway": "Escape",
  "Fortune cookie": "Prophecy",
};

const letterCount = (p) => (p.match(/[a-z0-9]/gi) || []).length;
const words = (p) => p.toLowerCase().split(/\s+/);
const valid = ([phrase, hint]) =>
  letterCount(phrase) >= MIN_LETTERS && /^[a-z]+$/i.test(hint) && !words(phrase).includes(hint.toLowerCase());

const VALID = Object.entries(PHRASES).filter(valid);
module.exports = VALID.map(([phrase]) => phrase);
module.exports.hints = Object.fromEntries(VALID);
module.exports.MIN_LETTERS = MIN_LETTERS;
