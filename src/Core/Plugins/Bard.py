from bardapi import Bard
import requests
import sys
import os

# set your __Secure-1PSID value to key
token1 = sys.argv[1]
token2 = sys.argv[2]
token3 = sys.argv[3]

# set your input text
input_text = sys.argv[4]

session = requests.Session()
session.cookies.set("__Secure-1PSID", token1)
session.cookies.set( "__Secure-1PSIDCC", token2)
session.cookies.set("__Secure-1PSIDTS", token3)
session.headers = {
        "Host": "bard.google.com",
        "X-Same-Domain": "1",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.4472.114 Safari/537.36",
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
        "Origin": "https://bard.google.com",
        "Referer": "https://bard.google.com/",
 }

bard = Bard(token=token1, session=session, timeout=30)

# Send an API request and get a response.
response = bard.get_answer(input_text)

print(response['content'])