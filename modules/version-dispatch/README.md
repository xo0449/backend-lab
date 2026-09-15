# switch로 범벅된 버전 분기를 표로 옮기기

## 고민

SDK는 하나인데 동작은 여러 갈래다. 플랫폼이 다르고, 앱 버전이 다르고,
배포 채널이 다르다. 기능마다 "어디서부터 켤 것인가"가 따로 정해진다.

순진하게 짜면 이렇게 된다.

```typescript
case 'biometricLogin':
  if (platform === 'ios') {
    if (major > 3) return true
    if (major === 3 && minor >= 2) return true
    return false
  }
  if (platform === 'android') {
    // 안드로이드는 3.5부터. 단 내부 채널은 3.4부터 켰다.
    if (channel === 'internal' && major === 3 && minor >= 4) return true
    if (major > 3) return true
    if (major === 3 && minor >= 5) return true
    return false
  }
  return false
```

한 번에 보면 이상하지만 **한 줄씩 추가될 때는 아무도 이상하게 여기지 않는다.**
"안드로이드 내부 채널에 먼저 열어달라"는 요청이 오면 저 한 줄을 넣는 게
가장 빠르고 안전해 보인다.

궁금했던 것은 이거다. **이 구조가 실제로 틀린 동작을 만드는가,
아니면 그냥 보기 싫을 뿐인가.**

## 접근

기능이 열리는 조건을 코드가 아니라 표로 옮겼다.

```typescript
export const CAPABILITIES: Record<Feature, Capability> = {
  biometricLogin: {
    since: { ios: '3.2.0', android: '3.5.0' },
    earlyAccess: {
      channels: ['beta', 'internal'],
      since: { ios: '3.2.0', android: '3.4.0' },
    },
  },
  ...
}
```

버전 비교는 값 객체로 뺐다. 문자열을 매번 잘라 major와 minor를 꺼내
비교하면 그 비교가 코드 곳곳에 흩어지고, 흩어지면 한 군데를 빠뜨린다.

```typescript
Version.parse('3.10.0').gte(Version.parse('3.9.0'))  // true
```

`3.10`이 `3.9`보다 크다는 것도 문자열 비교로는 틀린다.
자리별로 비교하는 곳이 하나면 한 번만 맞추면 된다.

## 결과 1. 전수 비교에서 불일치 3건이 나왔다

플랫폼 3개, 채널 3개, 버전 10개, 기능 5개를 모두 돌려 두 구현을 비교했다.

```bash
npx tsx modules/version-dispatch/bench/diff.ts
```

```
조합 450개 중 3개가 다르다

## biometricLogin (1건)
  android / beta / 3.4.0      개선 전 false → 표 기준 true

## inAppPurchase (2건)
  ios / internal / 3.8.0      개선 전 false → 표 기준 true
  android / internal / 3.8.0  개선 전 false → 표 기준 true
```

**셋 다 같은 종류의 실수다.** 선행 채널에 먼저 열어주는 정책인데,
한 곳은 `internal`만 열고 `beta`를 빠뜨렸고, 다른 곳은 `beta`만 열고
`internal`을 빠뜨렸다.

같은 개념을 두 곳에서 각각 구현했고, 두 번 다 절반씩 틀렸다.
코드를 읽어서는 알아채기 어렵다. 각각을 따로 보면 둘 다 말이 되기 때문이다.

정책을 한 표에 모으니 빠진 칸이 바로 보였다.

## 결과 2. 고칠 곳이 줄었다

| | 개선 전 | 개선 후 |
|---|---|---|
| 플랫폼 분기 지점 | 6곳 | 표 1곳 |
| 버전 비교 지점 | 15곳에 흩어짐 | 값 객체 1곳 |
| 의도와 어긋난 조합 | 3건 | 0건 |

새 플랫폼을 추가한다고 하자. 개선 전에는 기능마다 `switch`의 각 `case`를
찾아가 분기를 넣어야 한다. 다섯 군데다. 하나를 빠뜨리면 그 기능만
조용히 꺼진 채 배포된다.

표에서는 각 기능의 `since`에 한 줄씩 더하면 된다. 빠뜨리면
"이 플랫폼은 지원 안 함"이 되는데, 표를 보면 빈 칸이 눈에 띈다.

## 정책을 테스트로 고정할 수 있게 됐다

분기가 코드에 흩어져 있을 때는 "선행 채널은 항상 정식보다 먼저 받는다"
같은 규칙을 검사할 방법이 없었다. 표가 되니 규칙 자체를 테스트한다.

```typescript
it('선행 채널의 기준이 정식 기준보다 낮거나 같다', () => {
  for (const feature of FEATURES) {
    const { since, earlyAccess } = CAPABILITIES[feature]
    if (!earlyAccess) continue
    for (const [platform, min] of Object.entries(earlyAccess.since)) {
      const normal = since[platform]
      if (!normal) continue
      expect(Version.parse(normal).gte(Version.parse(min))).toBe(true)
    }
  }
})
```

개별 조합이 아니라 정책의 성질을 검사한다.
새 기능을 표에 추가할 때 실수하면 이 테스트가 잡는다.

## 다시 한다면

**표를 코드 밖으로 뺄지는 따져봐야 한다.** 원격 설정으로 두면 배포 없이
기능을 켜고 끌 수 있다. 대신 클라이언트가 설정을 못 받아온 상황의
기본값을 정해야 하고, 그 순간 다시 분기가 생긴다.
배포 주기가 짧다면 코드에 두는 편이 단순하다.

**이 실험의 표는 실제보다 단순하다.** 현실에서는 특정 버전 구간만
버그가 있어 빼야 하는 경우, 지역별로 다른 경우, A/B 테스트가 겹치는 경우가
있다. 구간과 예외가 들어오면 `since` 하나로는 부족하고 범위 표현이 필요하다.
그때도 표 안에서 풀리는지가 이 구조의 진짜 시험대다.

**기존 동작을 그대로 옮기지 않았다.** 전수 비교에서 나온 3건은
표 기준이 맞다고 보고 고친 것이다. 실무에서는 그 3건이 의도된 예외일 수도
있다. 리팩터링에서 동작이 바뀌는 지점을 찾았다면, 고치기 전에
왜 그렇게 되어 있었는지 먼저 확인해야 한다.
