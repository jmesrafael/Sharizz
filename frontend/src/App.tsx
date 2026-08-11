import { Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Room from "./pages/Room";
import UsageToast from "./components/UsageToast";

export default function App() {
  return (
    <>
      <UsageToast />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/room/:roomId" element={<Room />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </>
  );
}
