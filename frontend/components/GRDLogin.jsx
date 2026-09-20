'use client';

export function GRDLogin() {
  const socialLinks = [
    { name: 'Instagram', href: 'https://www.instagram.com/grdmotorsofficial/', icon: 'https://cdn.simpleicons.org/instagram/ffffff' },
    { name: 'Facebook', href: 'https://www.facebook.com/davratherickshaw/', icon: 'https://cdn.simpleicons.org/facebook/ffffff' },
    { name: 'WhatsApp', href: 'https://wa.me/917678171836', icon: 'https://cdn.simpleicons.org/whatsapp/ffffff' },
    { name: 'Website', href: 'https://davrath.com/', icon: 'https://cdn.simpleicons.org/googlechrome/ffffff' },
    { name: 'Google Maps', href: 'https://maps.app.goo.gl/6zKJLUG7Yyf28dKT8', icon: 'https://cdn.simpleicons.org/googlemaps/4285f4' },
  ];

  return (
    <main className="grdImageLogin">
      <style>{`
        .grdImageLogin{position:fixed;inset:0;background:#e9f8ff;overflow:hidden}
        .grdImageLogin picture,.grdImageLogin picture img{display:block;width:100%;height:100%;margin:0}
        .grdImageLogin picture img{object-fit:cover;object-position:center center;user-select:none;-webkit-user-drag:none}
        .grdSocialHotspots{position:absolute;inset:0;pointer-events:none}
        .grdSocialHotspot{position:absolute;bottom:1.3%;height:8%;min-height:42px;pointer-events:auto;display:flex;align-items:center;justify-content:center;border-radius:12px;text-decoration:none}
        .grdSocialHotspot img{width:30px;height:30px;object-fit:contain;filter:drop-shadow(0 2px 3px rgba(0,0,0,.22));transition:transform .15s ease}
        .grdSocialHotspot:hover img{transform:scale(1.12)}
        .grdSocialHotspot:nth-child(1){left:3.2%;width:11.5%}.grdSocialHotspot:nth-child(2){left:16.5%;width:11.5%}.grdSocialHotspot:nth-child(3){left:30%;width:14.5%}.grdSocialHotspot:nth-child(4){left:45.5%;width:13.5%}.grdSocialHotspot:nth-child(5){left:60%;width:13.5%}
        @media(max-width:800px){
          .grdImageLogin picture img{object-fit:cover;object-position:center center}
          .grdSocialHotspot{bottom:0.7%;height:7%;min-height:38px}
          .grdSocialHotspot img{width:26px;height:26px}
          .grdSocialHotspot:nth-child(1){left:3%;width:17%}.grdSocialHotspot:nth-child(2){left:22%;width:17%}.grdSocialHotspot:nth-child(3){left:41%;width:17%}.grdSocialHotspot:nth-child(4){left:59%;width:17%}.grdSocialHotspot:nth-child(5){left:78%;width:17%}
        }
      `}</style>
      <picture>
        <source media="(max-width: 800px)" srcSet="/grd-login-mobile.svg" />
        <img src="/grd-login-desktop.svg" alt="G.R.D. Motors login" draggable="false" />
      </picture>
      <nav className="grdSocialHotspots" aria-label="G.R.D. Motors social links">
        {socialLinks.map((s) => (
          <a key={s.name} className="grdSocialHotspot" href={s.href} target="_blank" rel="noopener noreferrer" aria-label={s.name} title={s.name}>
            <img src={s.icon} alt="" aria-hidden="true" />
          </a>
        ))}
      </nav>
    </main>
  );
}
