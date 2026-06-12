import { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Phone, Eye, EyeOff, Shield } from 'lucide-react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Input } from '@/components/FormFields';
import { toast } from 'react-hot-toast';

const schema = z.object({
  email: z.string().email('Valid email required'),
  password: z.string().min(1, 'Password required'),
  mfa_code: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

export default function Login() {
  const navigate = useNavigate();
  const { isAuthenticated, setAuth } = useAuthStore();
  const [showPassword, setShowPassword] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [loading, setLoading] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  if (isAuthenticated) return <Navigate to="/dashboard" replace />;

  const onSubmit = async (data: FormData) => {
    setLoading(true);
    try {
      const result = await authApi.login(data.email, data.password, data.mfa_code);
      setAuth(result.user, result.accessToken, result.refreshToken);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number; data?: { mfa_required?: boolean; message?: string } } })?.response?.status;
      const body = (err as { response?: { data?: { mfa_required?: boolean; message?: string } } })?.response?.data;
      if (status === 401 && body?.mfa_required) {
        setMfaRequired(true);
        toast('Enter your MFA code to continue.', { icon: '🔐' });
      } else {
        toast.error(body?.message ?? 'Invalid email or password.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-surface-900 via-surface-800 to-primary-950 p-4">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-32 w-96 h-96 bg-primary-600/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -left-32 w-80 h-80 bg-accent-600/20 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary-500 to-accent-500 shadow-elevated mb-4">
            <Phone size={24} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">AIpbx</h1>
          <p className="text-surface-400 text-sm mt-1">Cloud PBX Admin Console</p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-surface-800 rounded-2xl shadow-elevated ring-1 ring-surface-200 dark:ring-surface-700 p-6">
          <h2 className="text-lg font-semibold text-surface-900 dark:text-surface-100 mb-5">
            {mfaRequired ? 'Two-factor authentication' : 'Sign in to your account'}
          </h2>

          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            {!mfaRequired ? (
              <>
                <Input
                  label="Email address"
                  type="email"
                  autoComplete="email"
                  autoFocus
                  placeholder="admin@company.com"
                  error={errors.email?.message}
                  {...register('email')}
                />

                <div className="flex flex-col gap-1">
                  <label className="label">Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      placeholder="••••••••"
                      className={`input pr-10 ${errors.password ? 'input-error' : ''}`}
                      {...register('password')}
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute inset-y-0 right-0 pr-3 flex items-center text-surface-400 hover:text-surface-600"
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                  {errors.password && (
                    <p className="text-xs text-danger">{errors.password.message}</p>
                  )}
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2 mb-2">
                  <Shield size={16} className="text-primary-500" />
                  <p className="text-sm text-surface-600 dark:text-surface-400">
                    Enter the 6-digit code from your authenticator app.
                  </p>
                </div>
                <Input
                  label="MFA Code"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoFocus
                  placeholder="000000"
                  className="text-center text-xl tracking-[0.5em] font-mono"
                  error={errors.mfa_code?.message}
                  {...register('mfa_code')}
                />
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full h-10"
            >
              {loading ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : mfaRequired ? (
                'Verify'
              ) : (
                'Sign in'
              )}
            </button>

            {mfaRequired && (
              <button
                type="button"
                onClick={() => setMfaRequired(false)}
                className="btn-ghost w-full text-sm"
              >
                ← Back to login
              </button>
            )}
          </form>
        </div>

        <p className="text-center text-xs text-surface-500 mt-6">
          AIpbx © {new Date().getFullYear()} — Enterprise Cloud PBX
        </p>
      </div>
    </div>
  );
}
