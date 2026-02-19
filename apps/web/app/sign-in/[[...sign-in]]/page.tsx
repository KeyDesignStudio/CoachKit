import { SignIn } from '@clerk/nextjs';

export default function SignInPage() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-[420px]">
        <SignIn fallbackRedirectUrl="/" />
      </div>
    </div>
  );
}
