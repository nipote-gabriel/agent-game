// Secret phrases. The Citizens see the whole phrase; the Agent sees blanks
// (Wheel of Fortune style) and gets one more letter each round. Keep them vague
// so the Citizens' clues can stay loose. Letters, numbers and spaces only.
// Every phrase must have at least 12 letters (spaces don't count): shorter ones
// are filtered out below as a safety net, so they never get dealt.
const MIN_LETTERS = 12;

const PHRASES = [
  "Home field advantage", "Quiet confidence", "Breaking point", "Common ground", "Lost and found",
  "Behind the scenes", "Off the record", "Under construction", "Uncharted waters",
  "Wishful thinking", "First impression", "Guilty pleasure", "Muscle memory", "Happy accident",
  "Silver lining", "Distant thunder", "Midnight snack", "Morning ritual", "Branching paths",
  "Turning leaves", "Glass ceiling", "Moving target", "Rising tide at dawn", "Second chances",
  "Growing pains", "Mixed signals", "Hidden talents", "Borrowed time", "Golden hour light",
  "After the storm", "Long weekend away", "Last call at the bar", "Uphill battle",
  "Slow motion replay", "Open road ahead", "Cold feet at the altar", "Root of the problem",
  "Front row seat", "Road trip snacks", "Spare key under the mat", "Bright side of life",
  "Wild card entry", "Old habits die hard", "Full circle moment", "Under pressure",
  "Rush hour traffic", "Shooting star", "Castles in the air", "Butterflies in your stomach",
  "Elephant in the room", "Needle in a haystack", "Light at the end of the tunnel",
  "Calm before the storm", "Tip of the iceberg", "Writing on the wall", "Message in a bottle",
  "Ghost of a chance", "Change of heart", "Stroke of luck", "Fish out of water",
  "Under the weather", "Once in a blue moon", "Northern lights", "Secret ingredient",
  "Hidden treasure", "Starting line", "Finishing touches", "Spring cleaning", "Sunday morning",
  "Thunderstorm warning", "Campfire stories", "Haunted hallway", "Treehouse rules",
  "Weekend getaway", "Fortune cookie",
];

const letterCount = (p) => (p.match(/[a-z0-9]/gi) || []).length;
module.exports = [...new Set(PHRASES)].filter((p) => letterCount(p) >= MIN_LETTERS);
module.exports.MIN_LETTERS = MIN_LETTERS;
