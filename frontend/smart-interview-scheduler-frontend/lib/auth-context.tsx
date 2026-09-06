"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { User, Role, CalendarStatus } from "./types";

// --------------------------------------------------
// Stored user type
// Password is used only for frontend mock authentication.
// Your existing User type does not need a password field.
// --------------------------------------------------

type StoredUser = User & {
  password: string;
};

// --------------------------------------------------
// Auth Context Type
// --------------------------------------------------

interface AuthContextType {
  user: User | null;
  role: Role | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  calendarStatus: CalendarStatus;

  login: (
    email: string,
    password: string
  ) => Promise<User>;

  googleLogin: (
    idToken: string
  ) => Promise<User>;

  register: (data: {
    email: string;
    password: string;
    name: string;
    role: Role;
    timezone: string;
  }) => Promise<User>;

  logout: () => Promise<void>;

  refreshToken: () => Promise<void>;

  refreshCalendarStatus: () => Promise<void>;
}

// --------------------------------------------------
// Create Context
// --------------------------------------------------

const AuthContext =
  createContext<AuthContextType | undefined>(undefined);

// --------------------------------------------------
// Local Storage Keys
// --------------------------------------------------

const USERS_KEY = "smart_interview_users";

const CURRENT_USER_KEY =
  "smart_interview_current_user";

// --------------------------------------------------
// Get Dashboard Route Based on Role
// --------------------------------------------------

export const getDashboardRoute = (
  role: Role
): string => {
  switch (role) {
    case "ADMIN":
      return "/admin";

    case "PANELIST":
      return "/panelist";

    case "CANDIDATE":
      return "/candidate";

    default:
      return "/login";
  }
};

// --------------------------------------------------
// Default Demo Users
// Frontend only
// --------------------------------------------------

const defaultUsers: StoredUser[] = [
  {
    id: "admin-demo",
    name: "Admin User",
    email: "admin@demo.com",
    password: "Admin@123",
    role: "ADMIN",
    timezone: "Asia/Kolkata",
  },

  {
    id: "panelist-demo",
    name: "Panelist User",
    email: "panelist@demo.com",
    password: "Panelist@123",
    role: "PANELIST",
    timezone: "Asia/Kolkata",
  },

  {
    id: "candidate-demo",
    name: "Candidate User",
    email: "candidate@demo.com",
    password: "Candidate@123",
    role: "CANDIDATE",
    timezone: "Asia/Kolkata",
  },
];

// --------------------------------------------------
// Get Users from Local Storage
// --------------------------------------------------

const getStoredUsers = (): StoredUser[] => {
  if (typeof window === "undefined") {
    return defaultUsers;
  }

  const storedUsers =
    localStorage.getItem(USERS_KEY);

  // First time application is opened
  if (!storedUsers) {
    localStorage.setItem(
      USERS_KEY,
      JSON.stringify(defaultUsers)
    );

    return defaultUsers;
  }

  try {
    return JSON.parse(
      storedUsers
    ) as StoredUser[];
  } catch {
    // If localStorage contains invalid data,
    // restore the demo users.
    localStorage.setItem(
      USERS_KEY,
      JSON.stringify(defaultUsers)
    );

    return defaultUsers;
  }
};

// --------------------------------------------------
// Save Users to Local Storage
// --------------------------------------------------

const saveUsers = (
  users: StoredUser[]
) => {
  if (typeof window !== "undefined") {
    localStorage.setItem(
      USERS_KEY,
      JSON.stringify(users)
    );
  }
};

// --------------------------------------------------
// Remove Password Before Storing Current User
// --------------------------------------------------

const removePassword = (
  storedUser: StoredUser
): User => {
  const {
    password: _password,
    ...user
  } = storedUser;

  return user as User;
};

// --------------------------------------------------
// Auth Provider
// --------------------------------------------------

export const AuthProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [user, setUser] =
    useState<User | null>(null);

  const [isLoading, setIsLoading] =
    useState<boolean>(true);

  const [calendarStatus, setCalendarStatus] =
    useState<CalendarStatus>(
      "DISCONNECTED"
    );

  // ------------------------------------------------
  // Calendar Status
  // Backend will be connected later.
  // ------------------------------------------------

  const refreshCalendarStatus =
    async () => {
      setCalendarStatus(
        "DISCONNECTED"
      );
    };

  // ------------------------------------------------
  // Load Current User
  // ------------------------------------------------

  const loadCurrentUser =
    async (): Promise<User | null> => {
      if (typeof window === "undefined") {
        return null;
      }

      const storedUser =
        localStorage.getItem(
          CURRENT_USER_KEY
        );

      if (!storedUser) {
        setUser(null);
        return null;
      }

      try {
        const parsedUser =
          JSON.parse(
            storedUser
          ) as User;

        setUser(parsedUser);

        setCalendarStatus(
          "DISCONNECTED"
        );

        return parsedUser;
      } catch {
        localStorage.removeItem(
          CURRENT_USER_KEY
        );

        setUser(null);

        setCalendarStatus(
          "DISCONNECTED"
        );

        return null;
      }
    };

  // ------------------------------------------------
  // Initialize Authentication
  // ------------------------------------------------

  useEffect(() => {
    const initializeAuth =
      async () => {
        await loadCurrentUser();

        setIsLoading(false);
      };

    initializeAuth();
  }, []);

  // ------------------------------------------------
  // Login
  // ------------------------------------------------

  const login = async (
    email: string,
    password: string
  ): Promise<User> => {
    setIsLoading(true);

    try {
      const users =
        getStoredUsers();

      const foundUser =
        users.find(
          (existingUser) =>
            existingUser.email
              .toLowerCase() ===
              email
                .trim()
                .toLowerCase() &&
            existingUser.password ===
              password
        );

      // Invalid login
      if (!foundUser) {
        throw new Error(
          "Invalid email or password"
        );
      }

      // Remove password before storing
      // the currently logged-in user.
      const userWithoutPassword =
        removePassword(
          foundUser
        );

      localStorage.setItem(
        CURRENT_USER_KEY,
        JSON.stringify(
          userWithoutPassword
        )
      );

      setUser(
        userWithoutPassword
      );

      setCalendarStatus(
        "DISCONNECTED"
      );

      return userWithoutPassword;
    } finally {
      setIsLoading(false);
    }
  };

  // ------------------------------------------------
  // Google Login
  // Frontend-only placeholder
  // ------------------------------------------------

  const googleLogin =
    async (
      idToken: string
    ): Promise<User> => {
      setIsLoading(true);

      try {
        // Google authentication will be
        // connected when the backend is added.
        //
        // For now, use the demo candidate
        // account for frontend testing.

        const users =
          getStoredUsers();

        const googleUser =
          users.find(
            (existingUser) =>
              existingUser.role ===
              "CANDIDATE"
          );

        if (!googleUser) {
          throw new Error(
            "No demo Google user available"
          );
        }

        const userWithoutPassword =
          removePassword(
            googleUser
          );

        localStorage.setItem(
          CURRENT_USER_KEY,
          JSON.stringify(
            userWithoutPassword
          )
        );

        setUser(
          userWithoutPassword
        );

        setCalendarStatus(
          "DISCONNECTED"
        );

        return userWithoutPassword;
      } finally {
        setIsLoading(false);
      }
    };

  // ------------------------------------------------
  // Register
  // ------------------------------------------------

  const register = async (
    data: {
      email: string;
      password: string;
      name: string;
      role: Role;
      timezone: string;
    }
  ): Promise<User> => {
    setIsLoading(true);

    try {
      const users =
        getStoredUsers();

      // Check if email already exists
      const existingUser =
        users.find(
          (user) =>
            user.email
              .toLowerCase() ===
            data.email
              .trim()
              .toLowerCase()
        );

      if (existingUser) {
        throw new Error(
          "An account with this email already exists"
        );
      }

      // Create new user
      const newUser: StoredUser = {
        id:
          typeof crypto !==
            "undefined" &&
          typeof crypto.randomUUID ===
            "function"
            ? crypto.randomUUID()
            : Date.now().toString(),

        name: data.name.trim(),

        email: data.email.trim(),

        password: data.password,

        role: data.role,

        timezone: data.timezone,
      };

      // Save new user
      const updatedUsers = [
        ...users,
        newUser,
      ];

      saveUsers(
        updatedUsers
      );

      // Remove password from
      // current authenticated user
      const userWithoutPassword =
        removePassword(
          newUser
        );

      // Automatically log in
      localStorage.setItem(
        CURRENT_USER_KEY,
        JSON.stringify(
          userWithoutPassword
        )
      );

      setUser(
        userWithoutPassword
      );

      setCalendarStatus(
        "DISCONNECTED"
      );

      return userWithoutPassword;
    } finally {
      setIsLoading(false);
    }
  };

  // ------------------------------------------------
  // Logout
  // ------------------------------------------------

  const logout = async () => {
    if (typeof window !== "undefined") {
      localStorage.removeItem(
        CURRENT_USER_KEY
      );
    }

    setUser(null);

    setCalendarStatus(
      "DISCONNECTED"
    );

    if (typeof window !== "undefined") {
      window.location.href =
        "/login";
    }
  };

  // ------------------------------------------------
  // Refresh Token
  // Frontend-only for now
  // ------------------------------------------------

  const refreshToken =
    async () => {
      await loadCurrentUser();
    };

  // ------------------------------------------------
  // Provider
  // ------------------------------------------------

  return (
    <AuthContext.Provider
      value={{
        user,

        role:
          user?.role || null,

        isAuthenticated:
          !!user,

        isLoading,

        calendarStatus,

        login,

        googleLogin,

        register,

        logout,

        refreshToken,

        refreshCalendarStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// --------------------------------------------------
// useAuth Hook
// --------------------------------------------------

export const useAuth = () => {
  const context =
    useContext(
      AuthContext
    );

  if (!context) {
    throw new Error(
      "useAuth must be used within an AuthProvider"
    );
  }

  return context;
};
/*"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { User, Role, CalendarStatus } from "./types";
import {
  authApi,
  usersApi,
  calendarApi,
  getStoredAccessToken,
  clearStoredTokens,
} from "./api-client";

interface AuthContextType {
  user: User | null;
  role: Role | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  calendarStatus: CalendarStatus;
  login: (email: string, password: string) => Promise<User>;
  googleLogin: (idToken: string) => Promise<User>;
  register: (data: {
    email: string;
    password: string;
    name: string;
    role: Role;
    timezone: string;
  }) => Promise<void>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  refreshCalendarStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [calendarStatus, setCalendarStatus] = useState<CalendarStatus>("DISCONNECTED");

  const refreshCalendarStatus = useCallback(async () => {
    try {
      const res = await calendarApi.getStatus();
      setCalendarStatus(res.status);
    } catch {
      setCalendarStatus("DISCONNECTED");
    }
  }, []);

  const loadCurrentUser = useCallback(async (): Promise<User | null> => {
    try {
      const profile = await usersApi.getMe();
      setUser(profile);
      if (profile.role === "PANELIST" || profile.role === "ADMIN") {
        await refreshCalendarStatus();
      }
      return profile;
    } catch (err) {
      clearStoredTokens();
      setUser(null);
      setCalendarStatus("DISCONNECTED");
      return null;
    }
  }, [refreshCalendarStatus]);

  useEffect(() => {
    const initAuth = async () => {
      const token = getStoredAccessToken();
      if (token) {
        await loadCurrentUser();
      } else {
        setUser(null);
        setCalendarStatus("DISCONNECTED");
      }
      setIsLoading(false);
    };

    initAuth();
  }, [loadCurrentUser]);

  const login = async (email: string, password: string): Promise<User> => {
    setIsLoading(true);
    try {
      await authApi.login({ email, password });
      const profile = await usersApi.getMe();
      setUser(profile);
      if (profile.role === "PANELIST" || profile.role === "ADMIN") {
        await refreshCalendarStatus();
      }
      return profile;
    } finally {
      setIsLoading(false);
    }
  };

  const googleLogin = async (idToken: string): Promise<User> => {
    setIsLoading(true);
    try {
      // Identity ONLY (openid, email, profile). Calendar scope is strictly excluded.
      await authApi.googleLogin(idToken);
      const profile = await usersApi.getMe();
      setUser(profile);
      if (profile.role === "PANELIST" || profile.role === "ADMIN") {
        await refreshCalendarStatus();
      }
      return profile;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (data: {
    email: string;
    password: string;
    name: string;
    role: Role;
    timezone: string;
  }) => {
    setIsLoading(true);
    try {
      await authApi.register(data);
      // Log in immediately following successful registration
      await login(data.email, data.password);
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      clearStoredTokens();
      setUser(null);
      setCalendarStatus("DISCONNECTED");
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
    }
  };

  const refreshToken = async () => {
    await loadCurrentUser();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        role: user?.role || null,
        isAuthenticated: !!user,
        isLoading,
        calendarStatus,
        login,
        googleLogin,
        register,
        logout,
        refreshToken,
        refreshCalendarStatus,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};*/
