import type { FolderPublic } from "@shared/types";

interface Props {
  folder: FolderPublic;
  onOpen: (folder: FolderPublic) => void;
}

export default function FolderCard({ folder, onOpen }: Props) {
  return (
    <div className="file-card">
      <button
        type="button"
        className="folder-tile"
        onClick={() => onOpen(folder)}
        aria-label={`Open folder ${folder.folderName}`}
      >
        <span className="folder-icon">📁</span>
      </button>
      <div className="file-footer">
        <span className="file-name" title={folder.folderName}>
          {folder.folderName}
        </span>
      </div>
    </div>
  );
}
