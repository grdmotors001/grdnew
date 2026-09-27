const SB = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const avatarUrl = (path) => path ? SB + "/storage/v1/object/public/avatars/" + path : null;
export const initials = (n = "") => n.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
export default function Avatar({ name, src, size = 44, group = false }) {
  const url = avatarUrl(src);
  return <span className={"oc-av " + (group ? "is-group" : "")} style={{ width:size, height:size, fontSize:Math.round(size*0.36) }}>{url ? <img src={url} alt="" /> : initials(name)}</span>;
}
