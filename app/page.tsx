import { getChatGPTUser, chatGPTSignInPath } from "./chatgpt-auth";
import { Wishlist } from "./wishlist";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  if (!user) {
    return (
      <main className="signin-shell">
        <a className="brand" href="/" aria-label="모아봄 홈"><span className="brand-mark">m.</span><span>모아봄</span></a>
        <section className="signin-card">
          <span className="signin-icon">✳</span>
          <p className="eyebrow">MY LITTLE WISHLIST</p>
          <h1>갖고 싶은 마음,<br />잊어버리지 않게.</h1>
          <p className="signin-copy">사고 싶은 옷과 물건의 링크, 캡처를 한곳에 모아두세요.</p>
          <a className="primary-button signin-button" href={chatGPTSignInPath("/")} target="_top">내 보관함 열기 <span aria-hidden="true">↗</span></a>
          <p className="signin-note">로그인하면 나만 볼 수 있는 보관함이 만들어져요.</p>
        </section>
        <p className="signin-footer">마음에 든 순간을 오래 간직하는 방법</p>
      </main>
    );
  }
  return <Wishlist displayName={user.displayName} />;
}
