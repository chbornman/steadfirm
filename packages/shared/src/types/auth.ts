export interface User {
  id: string;
  name: string;
  email: string;
  image?: string;
}

export interface Session {
  user: User;
  session: {
    id: string;
    expiresAt: string;
  };
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  services: {
    photos: boolean;
    media: boolean;
    documents: boolean;
    audiobooks: boolean;
    files: boolean;
  };
}
