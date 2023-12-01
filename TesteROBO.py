from time import sleep

import requests
import undetected_chromedriver as uc
from selenium import webdriver
from selenium.webdriver.remote.webdriver import By

driver = uc.Chrome()
driver.get('https://blaze-4.com/pt/games/double')  # api da blaze
sleep(5)

# Mensagens Padrao
analise = 'Analisando...'
win = 'Green do Double'
win_branco = '⬜ Green do branco ⬜'
loss = 'Essa não deu!\nPare e volte mais tarde'
nao_confirmacao = 'Não confirmou Entrada \nAguarde o próximo sinal'


# Função que monitora a barra de cronômetro do double da blaze
# Se o cronômetro estiver correndo, ela vai parar o 1º bloco e vai para o 2º bloco
# Bloco 2 fica esperando o texto da barra de cronômetro sumir, se sumir significa que parou a contagem
def esperar():
    while True:
        try:
            driver.find_element(By.CLASS_NAME, 'time-left').find_element(By.TAG_NAME, 'span').text
            break
        except:
            pass

    while True:
        try:
            driver.find_element(By.CLASS_NAME, 'time-left').find_element(By.TAG_NAME, 'span').text
        except:
            break


# Retorna os últimos valores que saíram da blaze
def retornar_historico():
    return [i['color'] for i in requests.get('https://blaze.com/api/roulette_games/recent').json()][::-1]


# Retorna o último valor que saiu da blaze Double
def retornar_ultimo():
    return requests.get('https://blaze.com/api/roulette_games/current').json()['color']


# Código que interage com o robô do telegram
def enviar_mensagem(mensagem):
    bot_token = ''
    chat_id = '-1002130180350'
    url_blaze = '🎰 [Blaze](https://blaze-4.com/pt/games/double)'
    url = f'https://api.telegram.org/bot6735689675:AAE-U9zDRjovQABSAm95op0ZIB9KX90OOVw/sendMessage?chat_id=-1002130180350&text={mensagem}\nhttps://blaze-4.com/pt/games/double&parse_mode=Markdown'  # faz uma marcação no texto da mensagem para inserir o link url blaze
    requests.get(url)

# Cores e símbolos blaze double
cor = ['Branco', 'Preto', 'Vermelho']
simbolo = ['⬜', '⬛', '🟥']

# Dar o sinal para o nosso bot no telegram
print('Bot Grupo de sinais iniciado ...')
enviar_mensagem('Bot Grupo de sinais iniciado ...')
while True:
    try:
        print('ok')
        esperar()
        sleep(1.5)
        historico = retornar_historico()
        ultimo = retornar_ultimo()
        historico.append(ultimo)
        padrao = historico[-4:]
        print(padrao)
        confirmacao = f'{simbolo[padrao[0]]} Entrada confirmada no {cor[padrao[0]]}\n{simbolo[0]} Proteção no branco'
        gale1 = f'Vamos para o gale 1 \n{simbolo[padrao[0]]} {cor[padrao[0]]}\n{simbolo[0]} Proteção no Branco'
        gale2 = f'Vamos para o gale 2 \n{simbolo[padrao[0]]} {cor[padrao[0]]}\n{simbolo[0]} Proteção no Branco'

        # Como as estratégias sempre jogam na cor contrária, resolvi colocar as cores
        # Vermelha e Preta em índices diferentes para aproveitar a lógica
        if padrao == [1, 1, 1, 1] or padrao == [2, 2, 2, 2] or padrao == [1, 2, 1, 2] or padrao == [2, 1, 2, 1]:
            enviar_mensagem(analise)
            esperar()
            sleep(1.5)
            ultimo = retornar_ultimo()
            while True:
                if ultimo == padrao[0]:
                    enviar_mensagem(confirmacao)
                    esperar()
                    sleep(1.5)
                    ultimo_ = retornar_ultimo()
                    if ultimo_ != ultimo and ultimo_ != 0:
                        enviar_mensagem(win)
                        break
                    elif ultimo_ == 0:
                        enviar_mensagem(win_branco)
                        break
                    else:
                        if martin_gale(gale1, ultimo):
                            break
                        else:
                            if martin_gale(gale2, ultimo):
                                break
                            else:
                                enviar_mensagem(loss)
                                break

                else:
                    enviar_mensagem(nao_confirmacao)
                    break
    except Exception as e:
        print(e)
        driver.get('https://blaze-4.com/pt/games/double')
        sleep(10)
        pass
