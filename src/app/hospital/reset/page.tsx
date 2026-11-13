import PasswordResetForm from "./password-reset-form";

export default async function HospitalPasswordResetPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return <PasswordResetForm token={token ?? ""} />;
}
