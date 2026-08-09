import { MongoDBAdapter } from "@auth/mongodb-adapter";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import mongoClient, { databaseName } from "./lib/mongodb";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: MongoDBAdapter(mongoClient, { databaseName }),
  session: { strategy: "jwt" },
  providers: [Google],
  pages: { signIn: "/" },
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) token.userId = user.id;
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        Object.assign(session.user, {
          id: typeof token.userId === "string" ? token.userId : token.sub,
        });
      }
      return session;
    },
  },
});
