/* ga-init.js — GA4 bootstrap, shared by every page.
 *
 * 인라인 <script>로 두면 엄격한 Content-Security-Policy(script-src에
 * 'unsafe-inline' 없음, vercel.json 참고)에서 막힌다 — 그래서 별도 파일로
 * 빼서 동일 출처(self) 스크립트로 로드한다. 5개 페이지가 전부 이 파일
 * 하나를 그대로 쓰므로 측정 ID를 나중에 바꿀 때도 한 곳만 고치면 된다.
 *
 * 개인정보: anonymize_ip로 IP를 저장 전에 잘라내고, allow_google_signals를
 * 꺼서 광고용 신호(리마케팅 등)는 전혀 보내지 않는다 — AdSense 승인
 * 전까지는 순수 측정 목적으로만 쓴다는 privacy.html의 안내와 일치시킨
 * 설정이다.
 */
window.dataLayer = window.dataLayer || [];
function gtag() { dataLayer.push(arguments); }
gtag('js', new Date());
gtag('config', 'G-CPBFW58QG6', {
  anonymize_ip: true,
  allow_google_signals: false
});
