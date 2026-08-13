// Turns "a whole folder was dropped/selected" into a flat list of files
// paired with the relative directory they came from, so callers can create
// matching folders (deepest-first-safe order) and upload each file into
// the right one — this is the only thing folder uploads add on top of a
// normal multi-file upload; the actual upload path is unchanged.

export interface StagedFile {
  file: File;
  relativeDir: string; // "" for the drop target's own root, else "Sub" or "Sub/Nested"
}

// From <input type="file" webkitdirectory multiple> — each File carries its
// path relative to the picked folder in .webkitRelativePath (non-standard
// but universally supported where webkitdirectory itself is supported).
export function stageFilesFromFileList(fileList: FileList): StagedFile[] {
  return Array.from(fileList).map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    if (!rel) return { file, relativeDir: "" };
    const parts = rel.split("/");
    parts.pop(); // drop the filename itself
    return { file, relativeDir: parts.join("/") };
  });
}

export function containsDirectory(items: DataTransferItemList): boolean {
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry?.();
    if (entry?.isDirectory) return true;
  }
  return false;
}

function readDirectoryEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    // readEntries only returns a batch at a time (spec quirk) — keep
    // calling until an empty batch signals the directory is exhausted.
    const readBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        readBatch();
      }, reject);
    };
    readBatch();
  });
}

async function walkEntry(entry: FileSystemEntry, relativeDir: string, out: StagedFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, relativeDir });
    return;
  }
  if (entry.isDirectory) {
    const childDir = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
    const children = await readDirectoryEntries((entry as FileSystemDirectoryEntry).createReader());
    for (const child of children) await walkEntry(child, childDir, out);
  }
}

// Drag-and-drop version — DataTransferItem.webkitGetAsEntry() must be
// called synchronously inside the drop handler (before the event's data
// is cleared), so callers grab the entries themselves and hand them here;
// only the recursive directory walk itself is async.
export async function stageFilesFromEntries(entries: FileSystemEntry[]): Promise<StagedFile[]> {
  const out: StagedFile[] = [];
  for (const entry of entries) await walkEntry(entry, "", out);
  return out;
}
