export interface Stringifiable {
  toString(): string;
}

export class ImagePreviewCollection<T extends Stringifiable> {
  private readonly entries: T[] = [];

  get hasEntries(): boolean {
    return this.entries.length > 0;
  }

  get values(): readonly T[] {
    return this.entries;
  }

  add(entry: T): boolean {
    if (this.entries.some((existing) => existing.toString() === entry.toString())) {
      return false;
    }

    this.entries.push(entry);
    return true;
  }

  clear(): void {
    this.entries.length = 0;
  }
}
