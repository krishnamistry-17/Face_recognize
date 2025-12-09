import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "../lib/supabase";
const Navbar = () => {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  console.log("isLoggedIn", isLoggedIn);
  const navigate = useNavigate();
  const handleLogout = async () => {
    await supabase.auth.signOut();
    setIsLoggedIn(false);
    navigate("/login");
  };

  useEffect(() => {
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      setIsLoggedIn(!!data.session);
    };
    check();
  }, []);

  return (
    <>
      {isLoggedIn ? (
        <div className="flex justify-end items-center  p-4 shadow-sm bg-white py-2 w-full">
          <button className=" rounded-md p-2" onClick={handleLogout}>
            Logout
          </button>
        </div>
      ) : (
        <div className="flex justify-end items-center  p-4 shadow-sm bg-white py-2 w-full">
          <button
            className=" rounded-md p-2"
            onClick={() => navigate("/login")}
          >
            Login
          </button>
          <button
            className=" rounded-md p-2"
            onClick={() => navigate("/signup")}
          >
            Signup
          </button>
        </div>
      )}
    </>
  );
};

export default Navbar;
