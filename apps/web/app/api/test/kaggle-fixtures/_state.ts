type KaggleFixtureMode = 'good' | 'bad' | 'missing';

let mode: KaggleFixtureMode = 'good';

export function setKaggleFixtureMode(next: KaggleFixtureMode) {
  mode = next;
}

export function getKaggleFixtureMode(): KaggleFixtureMode {
  return mode;
}
