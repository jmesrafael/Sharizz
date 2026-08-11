import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import CreateRoom from "./pages/CreateRoom";
import EnterRoom from "./pages/EnterRoom";
import Room from "./pages/Room";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/create" element={<CreateRoom />} />
      <Route path="/enter" element={<EnterRoom />} />
      <Route path="/room/:roomId" element={<Room />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
