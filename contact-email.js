/* contact-email.js — contact.html 전용.
 *
 * 이메일 주소를 정적 HTML에 그대로 두면 페이지 소스를 그냥 훑는 가장
 * 단순한 수집 봇에 바로 걸린다 — 그래서 아이디/도메인 조각을 런타임에
 * 조립해서 진짜 mailto 링크를 만들어 넣는다. 인라인 <script>가 아니라
 * 별도 파일인 이유는 엄격한 CSP(script-src에 'unsafe-inline' 없음,
 * vercel.json 참고) 아래서도 동일 출처(self) 스크립트로 정상 로드되게
 * 하기 위함 — JS가 꺼져 있으면 이 파일 자체가 안 실리므로, contact.html의
 * <noscript> 안 버튼(직접 박아둔 진짜 mailto 링크)이 유일한 접점이 된다.
 */
(function () {
  var el = document.getElementById('contact-email');
  if (!el) return;
  var user = 'easymahjongsolitaire';
  var domain = 'gmail.com';
  var address = user + '@' + domain;
  var link = document.createElement('a');
  link.href = 'mailto:' + address;
  link.textContent = address;
  el.textContent = 'Email: ';
  el.appendChild(link);
})();
