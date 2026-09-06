"use client";

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
};
