param(
  [string]$Model = "gpt-4o-mini",
  [string]$Prompt = "Reply with one word: pong."
)
$H = @{ Authorization = "Bearer $env:OPENAI_API_KEY"; "Content-Type"="application/json" }
$B = @{
  model    = $Model
  messages = @(@{ role="user"; content=$Prompt })
  max_tokens = 32
} | ConvertTo-Json -Depth 6
$r = Invoke-RestMethod https://api.openai.com/v1/chat/completions -Headers $H -Method POST -Body $B
$r.choices[0].message.content
