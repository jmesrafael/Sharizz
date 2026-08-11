import { Link } from "react-router-dom";

export default function Home() {
  return (
    <div className="page">
      <div className="container">
        <span className="brand">
          SHA<span className="brand-mark">RIZZ</span>
        </span>

        <h1 className="headline">Transfer photos and videos without compression.</h1>
        <p className="subtext">
          Upload original files, share temporary storage, and let others download the originals.
        </p>

        <div className="home-actions">
          <Link to="/create" className="btn btn-primary btn-block">
            Create Storage
          </Link>
          <Link to="/enter" className="btn btn-secondary btn-block">
            Enter Storage
          </Link>
        </div>

        <div className="feature-list">
          <div className="item">
            <span className="dot">●</span> Original files preserved, byte for byte
          </div>
          <div className="item">
            <span className="dot">●</span> No compression, no quality reduction
          </div>
          <div className="item">
            <span className="dot">●</span> Storage automatically expires after 7 days
          </div>
        </div>
      </div>
    </div>
  );
}
