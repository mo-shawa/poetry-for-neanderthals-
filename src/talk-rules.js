// Each round deals one talk rule that both teams play by. The ref watches for
// it on top of the always-on rules (no gestures, no saying the word, and so on).
export const TALK_RULES = [
  {
    id: 'one-syllable',
    name: 'One syllable',
    text: 'Only words with one syllable.',
    example: '“Big. Bright. Goes boom in the sky.”',
  },
  {
    id: 'questions',
    name: 'Questions only',
    text: 'Everything you say has to be a question.',
    example: '“Is it hot? Does it go boom? Do you see it in July?”',
  },
  {
    id: 'three-words',
    name: 'Three words',
    text: 'Say three words at most, then wait for a guess.',
    example: '“Night sky boom.” … “Loud colorful sparks.”',
  },
  {
    id: 'no-s',
    name: 'No S',
    text: 'No words with the letter S in them.',
    example: '“Light in the night. Kaboom! Red, green, blue.”',
  },
  {
    id: 'not',
    name: 'Not that',
    text: 'Only say what it is not.',
    example: '“Not quiet. Not boring. Not for daytime.”',
  },
  {
    id: 'tiny-words',
    name: 'Tiny words',
    text: 'No word longer than four letters.',
    example: '“Big pop up high. Red and gold. July.”',
  },
  {
    id: 'sing',
    name: 'Sing it',
    text: 'Sing everything you say. Stop singing and it’s a foul.',
    example: '♪ “It lights up the night and goes BOOM!” ♪',
  },
];

export const CLASSIC_RULE = 'one-syllable';

export const ruleById = (id) => TALK_RULES.find((rule) => rule.id === id) ?? TALK_RULES[0];
