"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import { User, Role, CalendarStatus } from "./types";
import {
  authApi,
  usersApi,
  calendarApi,
  invitationsApi,
  getStoredAccessToken,
  clearStoredTokens,
  setCachedProfile,
} from "./api-client";

interface AuthContextType {
  user: User | null;
  role: Role | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  calendarStatus: CalendarStatus;
  login: (email: string, password: string) => Promise<User>;
  register: (data: {
    email: string;
    password: string;
    name: string;
    timezone: string;
  }) => Promise<User>;
  bootstrapAdmin: (data: {
    email: string;
    password: string;
    name: string;
    timezone: string;
    bootstrap_token: string;
  }) => Promise<User>;
  claimInvitationAccount: (token: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  refreshToken: () => Promise<void>;
  refreshCalendarStatus: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const getDashboardRoute = (role: Role): string => {
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

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [calendarStatus, setCalendarStatus] =
    useState<CalendarStatus>("DISCONNECTED");

  const applyUser = useCallback((next: User | null) => {
    setUser(next);
    setCachedProfile(next);
  }, []);

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
      applyUser(profile);
      if (profile.role === "PANELIST" || profile.role === "ADMIN") {
        await refreshCalendarStatus();
      }
      return profile;
    } catch {
      clearStoredTokens();
      applyUser(null);
      setCalendarStatus("DISCONNECTED");
      return null;
    }
  }, [applyUser, refreshCalendarStatus]);

  useEffect(() => {
    const initAuth = async () => {
      if (getStoredAccessToken()) {
        await loadCurrentUser();
      } else {
        applyUser(null);
        setCalendarStatus("DISCONNECTED");
      }
      setIsLoading(false);
    };
    initAuth();
  }, [loadCurrentUser, applyUser]);

  const login = async (email: string, password: string): Promise<User> => {
    setIsLoading(true);
    try {
      await authApi.login({ email, password });
      const profile = await usersApi.getMe();
      applyUser(profile);
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
    timezone: string;
  }): Promise<User> => {
    setIsLoading(true);
    try {
      // Backend always creates a CANDIDATE and returns no token; log in next.
      await authApi.register(data);
      return await login(data.email, data.password);
    } finally {
      setIsLoading(false);
    }
  };

  const bootstrapAdmin = async (data: {
    email: string;
    password: string;
    name: string;
    timezone: string;
    bootstrap_token: string;
  }): Promise<User> => {
    setIsLoading(true);
    try {
      // Returns a full token pair on success; load the profile like login does.
      await authApi.bootstrapAdmin(data);
      const profile = await usersApi.getMe();
      applyUser(profile);
      await refreshCalendarStatus();
      return profile;
    } finally {
      setIsLoading(false);
    }
  };

  const claimInvitationAccount = async (token: string, password: string): Promise<User> => {
    setIsLoading(true);
    try {
      // Returns a full token pair on success; load the profile like login does.
      await invitationsApi.claimAccount(token, { password });
      const profile = await usersApi.getMe();
      applyUser(profile);
      if (profile.role === "PANELIST" || profile.role === "ADMIN") {
        await refreshCalendarStatus();
      }
      return profile;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      clearStoredTokens();
      applyUser(null);
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
        register,
        bootstrapAdmin,
        claimInvitationAccount,
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
