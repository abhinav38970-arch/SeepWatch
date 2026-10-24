import pandas as pd, numpy as np
def load(f, daily_from_hourly=False):
    d=pd.read_csv(f)
    d['t']=pd.to_datetime(d['DATE TIME'],format='%Y%m%d %H%M')
    d['v']=pd.to_numeric(d['VALUE'],errors='coerce')
    s=d.set_index('t')['v']
    if daily_from_hourly:
        c=s.resample('D').count(); s=s.resample('D').mean(); s[c<20]=np.nan
    return s
mil=load('MIL85_D.csv'); grfd=load('GRF41_D.csv'); grfh=load('GRF20_H.csv',True); sjb=load('SJB20_H.csv',True)
sdp=load('SDP20_D.csv'); swa=load('SWA20_D.csv')
df=pd.concat([mil.rename('MIL'),grfh.rename('GRF'),grfd.rename('GRF41'),sjb.rename('SJB'),sdp.rename('SDP'),swa.rename('SWA')],axis=1)
print(df.describe().T[['count','mean','50%','max']])
print('GRF hourly-mean vs official daily:',(df['GRF']-df['GRF41']).abs().describe().round(2).to_dict())
df['R1']=df['GRF']-df['MIL'].shift(3)
df['R2A']=df['SJB']-df['GRF'].shift(1)
df['R2B3']=df['SDP']-df['SJB'].shift(1)
df['R4A']=df['SWA']-df['SDP'].shift(1)
df['y']=df.index.year
for r,up in [('R1','MIL'),('R2A','GRF'),('R2B3','SJB'),('R4A','SDP')]:
    x=df[[r,up,'y']].dropna(); x=x[x[up]>=50]
    print('\n',r,'upstream',up,'n(flow>=50)=',len(x))
    g=x.groupby('y').agg(n=(r,'size'),flow=(up,'median'),loss_med=(r,'median'),p10=(r,lambda s:s.quantile(.1)),p90=(r,lambda s:s.quantile(.9)))
    g['frac_med']=g.loss_med/g.flow
    print(g.round(2).to_string())
df.to_csv('daily.csv')
