// import React from "react";
// import "./index.css";
// import Login from "./pages/login";
// import Signup from "./pages/signup";
// import FaceRecognition from "./components/FaceRecognition";
// import Navbar from "./components/navbar";
// import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";

// function App() {
//   return (
//     <div className="App">
//       <BrowserRouter>
//         <Navbar />
//         <div className="container mx-auto px-4 py-6">
//           <Routes>
//             {/* <Route path="/" element={<Navigate to="/login" replace />} /> */}
//             <Route path="/face" element={<FaceRecognition />} />
//             {/* <Route path="*" element={<Navigate to="/login" replace />} /> */}
//           </Routes>
//         </div>
//       </BrowserRouter>
//     </div>
//   );
// }

// export default App;


import React from 'react'
import FaceRecognition from './components/FaceRecognition'
const App = () => {
  return (
    <div>
      <FaceRecognition />
    </div>
  )
}

export default App